﻿//TODO: These variables need to persist because they maintain state when GUI isn't open, but this does not seem like the right place for them to be.
var _player = null;
var _currentSong = null;
var _port = null;
var _ready = false;
var _exploreEnabled = false;

function player() {
    var _playlist = playlist();

    if (!_port) {
        _port = chrome.extension.connect({ name: "statusPoller" });
        _port.onDisconnect.addListener(function () { _port = null; });
    }

    if (_player) {
        var playerState = _player.getPlayerState();
        _port.postMessage({ playerState: playerState, songs: _playlist.getSongs(), currentSong: _currentSong });
    }
    else {
        //Create YT player iframe.
        YT_ready(function () {
            var frameID = getFrameID("MusicHolder");
            if (frameID) {
                _player = new YT.Player(frameID, {
                    events: {
                        "onReady": function () {
                            //player functionality not available until ready   
                            _ready = true;

                            //If there is a song to cue might as well have it ready to go.
                            if (_playlist.songCount() > 0)
                                player.cueSongById(_playlist.getSongs()[0].id);
                        },
                        "onStateChange": function (playerState) {
                            //If the UI is closed we can't post a message to it -- so need to handle next song in background.
                            //The player can be playing in the background and UI changes may try and be posted to the UI, need to prevent.
                            if (playerState.data == PlayerStates.ENDED) {
                                if (_playlist.songCount() > 1)
                                    player.loadSongById(player.getNextSong().id);
                            }
                            else if (_port)
                                _port.postMessage({ playerState: playerState.data, songs: _playlist.getSongs(), currentSong: _currentSong });

                        },
                        "onError": function (error) {
                            switch (error.data) {
                                case 2:
                                    throw "Request contains an invalid parameter. For example, this error occurs if you specify a video ID that does not have 11 characters, or if the video ID contains invalid characters, such as exclamation points or asterisks.";
                                    break;
                                case 100:
                                    throw "Video requested is not found. This occurs when a video has been removed (for any reason), or it has been marked as private.";
                                    break;
                                case 101:
                                case 150:
                                    throw "Video requested does not allow playback in the embedded players";
                                    break;
                                default:
                                    throw "I received an error and I don't know what happened!";
                                    break;
                            }
                        }
                    }
                });
            }
        });
    }

    var player = {
        setCurrentSongById: function (id) {
            _currentSong = _playlist.getSongById(id);
        },

        setExploreEnabled: function (enable) {
            _exploreEnabled = enable;
        },

        getExploreEnabled: function () {
            return _exploreEnabled;
        },

        getNextSong: function () {
            return _playlist.getNextSong(_currentSong.id);
        },

        setVolume: function (volume) {
            volume ? _player.setVolume(volume) : _player.mute();
        },

        //Will return undefined until PlayerStates.VIDCUED
        getVolume: function () {
            return _player.getVolume();
        },

        sync: function (songIds) {
            _playlist.sync(songIds);
        },

        removeSongById: function (id) {
            var song = _playlist.getSongById(id);
            var nextSong = this.getNextSong();
            _playlist.removeSongById(id);

            //Deleting the visually-selected song.
            if (_currentSong.id == song.id) {
                //No songs left to delete because getNextSong looped around.
                if (nextSong.id == _currentSong.id) {
                    //**WARNING**: Do not use clearVideo(); here. Doing so will fire VIDCUED events.
                    _currentSong = null;

                    //Send a message either via pauseVideo or a custom message -- no event sent if video isn't playing.
                    if (_player.getPlayerState() == PlayerStates.PLAYING)
                        _player.pauseVideo();
                    else
                        _port.postMessage({ action: 'Song Removed', songs: _playlist.getSongs(), currentSong: _currentSong });
                }
                else
                    this.cueSongById(nextSong.id);
            }
            else {
                //If state of player hasn't changed (due to stopping or cueing) send a message to inform of song removal.
                _port.postMessage({ action: 'Song Removed', songs: _playlist.getSongs(), currentSong: _currentSong });
            }
        },

        addSongById: function (id) {
            var self = this;
            _playlist.addSongById(id, function (song) {
                var songCount = _playlist.songCount();
                if (songCount == 1)
                    self.cueSongById(song.id);

                _port.postMessage({ action: 'Song Added', songs: _playlist.getSongs(), currentSong: _currentSong });
            });
        },

        getCurrentTime: function () {
            var currentTime = null;
            var timeInSeconds = 0;

            if (_player.getPlayerState() == PlayerStates.ENDED && _currentSong)
                currentTime = _currentSong.totalTime;
            else {
                if (_ready && _currentSong)
                    timeInSeconds = _player.getCurrentTime() || 0;

                currentTime = GetTimeFromSeconds(timeInSeconds);
            }

            return currentTime;
        },

        getTotalTime: function () {
            var totalTime = GetTimeFromSeconds(0);

            if (_currentSong)
                totalTime = _currentSong.totalTime;

            return totalTime;
        },

        play: function () {
            if (_player.getPlayerState() != PlayerStates.PLAYING)
                _player.playVideo();
        },

        pause: function () {
            _player.pauseVideo();
        },

        loadSongById: function (id) {
            _currentSong = _playlist.getSongById(id);
            _player.loadVideoById(_currentSong.songId);
        },

        cueSongById: function (id) {
            _currentSong = _playlist.getSongById(id);
            _player.cueVideoById(_currentSong.songId);
        },

        shuffle: function () {
            _playlist.shuffle();
            _port.postMessage({ action: 'Shuffle', songs: _playlist.getSongs(), currentSong: _currentSong });
        },

        skipSong: function () {
            var nextSong = this.getNextSong();
            if (_player.getPlayerState() == PlayerStates.PLAYING)
                this.loadSongById(nextSong.id)
            else
                this.cueSongById(nextSong.id);
        }
    }

    return player;
}

