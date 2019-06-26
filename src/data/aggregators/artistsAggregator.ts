import { getRepository, Not, IsNull } from 'typeorm';

import {
    Aggregator,
    ArtistsAggregation,
    TrackAggregation,
} from './aggregator';
import { ProfileEntity } from '../../entities/entities';
import { SpotifyApi } from '../../helpers/classes/spotifyApi';
import { TrackAggregator } from './trackAggregator';

/**
 * multi-[[ReviewAggregation]] generator class for [[ProfileEntity]]
 */
export class ArtistsAggregator extends Aggregator<ProfileEntity, ArtistsAggregation> {
    private artistIds: string[];

    /**
     * Departure from normal behavior of [[Aggregator.generateAggregate]]. This aggregator needs to
     * be able to function wholely outside of the database environment, to allow aggregations on
     * data that has not been scraped. Therefore, it should never strictly require
     * [[Aggregator.entity]].
     */
    protected async generateAggregate(normalized: boolean): Promise<ArtistsAggregation> {
        if(this.entity) {
            this.entity = await getRepository(ProfileEntity).findOne({
                relations: [
                    'favoriteArtists',
                ],
                where: {
                    id: this.entity.id,
                    spotifyId: Not(IsNull()),
                },
            });
            if(this.entity.favoriteArtists == null) throw new Error(`Aggregated profile has no spotify-listed favorite artists: ${this.entity.name}`);
            this.artistIds = this.entity.favoriteArtists.map(artist => artist.spotifyId);
        } else if(this.artistIds == null) {
            throw new Error('Must send profile or id list to aggregate artists');
        }

        const aggregation = this.template(null);
        const spotifyApi = SpotifyApi.getConnection();
        const blankTrackAggregator = new TrackAggregator(null);

        const trackAggregations = await Promise.all(
            this.artistIds.map(async (artistId): Promise<TrackAggregation> => {
                const response = await spotifyApi.getArtistTopTracks(artistId);
                if(response.total === 0) return null;
                const track = response.items.shift();
                const features = await spotifyApi.getTrackAudioFeatures(track.id);
                const allTrackProperties = {
                    ...features,
                    duration: track.duration_ms,
                    explicit: track.explicit ? 1 : 0,
                    timeSignatureVariation: (4 - features.time_signature) ** 2,
                };
                const trackAggregation = blankTrackAggregator.template(0);
                for(const prop in allTrackProperties) {
                    if(prop in trackAggregation) {
                        trackAggregation[prop] = trackAggregation[prop];
                    }
                }
                if(normalized) return blankTrackAggregator.normalize(trackAggregation);
                return trackAggregation;
            }),
        );
        const trackCount = trackAggregations.length;
        trackAggregations.forEach((track) => {
            for(const trackProp in track) {
                if(trackProp in aggregation) {
                    if(trackProp === 'duration') {
                        aggregation[trackProp] += track[trackProp];
                    } else {
                        aggregation[trackProp] += track[trackProp] / trackCount;
                    }
                }
            }
        });

        const artistsInfo = await Promise.all(
            this.artistIds.map(artistId => spotifyApi.getArtist(artistId)),
        );
        artistsInfo.forEach((artistInfo) => {
            const { popularity } = artistInfo;
            if(aggregation.highestPopularity < popularity) {
                aggregation.highestPopularity = popularity;
            } if(aggregation.lowestPopularity > popularity) {
                aggregation.lowestPopularity = popularity;
            }
            aggregation.averagePopularity += popularity / artistsInfo.length;
        });
        return aggregation;
    }

    protected normalize(raw: ArtistsAggregation): ArtistsAggregation {
        return {
            ...raw,
            duration: Math.cbrt(raw.duration) / 85,
            averagePopularity: raw.averagePopularity / 100,
            highestPopularity: raw.highestPopularity / 100,
            lowestPopularity: raw.lowestPopularity / 100,
        };
    }

    public template(defaultVal: number): ArtistsAggregation {
        const track = new TrackAggregator(null).template(defaultVal);
        return {
            ...track,
            averagePopularity: defaultVal,
            highestPopularity: defaultVal,
            lowestPopularity: defaultVal,
        };
    }
}