import * as Spotify from 'spotify';

import { ArtistEntity } from '../../../entities/entities';
import { SpotifyEntityTracksScraper } from './spotifyIdTracksScraper';

/**
 * Spotify Artist Track Scraper *-> CSV FILE* (not database)
 *
 * Scrapes top 10 tracks for a given artist or first 6 tracks for a given album
 */
export class SpotifyArtistTracksScraper extends SpotifyEntityTracksScraper<ArtistEntity> {
    public constructor(
        spotifyId: string,
        saveDirectory: string = null,
        trackCount = 5,
        encode = true,
        normalize = true,
        verbose = false,
    ) {
        super('artist', spotifyId, saveDirectory, encode, normalize, verbose);

        this.modelPath = process.env.MODEL_LOCATION_ARTIST_TRACK_ENCODER;
        this.trackCount = trackCount;
    }

    public async requestScrape(): Promise<void> {
        this.spotifyResponse = await this.spotifyApi.getArtistTopTracks(this.spotifyId);
        if(this.spotifyResponse.tracks.length < this.trackCount) throw new Error(`Artist scraper found less than ${this.trackCount} top tracks`);
        this.spotifyResponse.tracks = this.spotifyResponse.tracks.slice(0, this.trackCount);
        const trackIds = this.spotifyResponse.tracks.map(track => track.id);

        this.spotifyFeaturesResponse = await this.spotifyApi.getBatch<Spotify.AudioFeatureBatchResponse>(trackIds, 'audio-features');
    }
}
