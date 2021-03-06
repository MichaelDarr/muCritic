import { getConnection } from 'typeorm';

import { ArtistScraper } from './artistScraper';
import {
    ArtistEntity,
    ProfileEntity,
} from '../../entities/entities';
import { Log } from '../../helpers/classes/log';
import { ParseElement } from '../../helpers/parsing/parseElement';
import { RymScraper } from './rymScraper';

/**
 * Manages the scraping and storage of a profile from [Rate Your Music](https://rateyourmusic.com/).
 *
 * For more information on class properties, see corresponding props in [[ProfileEntity]].
 */
export class ProfileScraper extends RymScraper<ProfileEntity> {
    public age: number;

    public favoriteArtists: ArtistScraper[];

    public gender: boolean;

    public name: string;

    public constructor(
        name: string,
        verbose = false,
    ) {
        super(
            `https://rateyourmusic.com/~${name}`,
            `RYM User: ${name}`,
            verbose,
        );
        this.name = name;
        this.dataReadFromLocal = false;
        this.favoriteArtists = [];
        this.repository = getConnection().getRepository(ProfileEntity);
    }

    protected extractInfo(): void {
        this.extractUserInfo();
        this.extractArtists();
    }

    /**
     * Extracts and stores:
     * - [[ProfileScraper.favoriteArtists]]
     */
    private extractArtists(): void {
        // extracts all content blocks from the page
        const unserInfoBlockParsers = this.scrapeRoot
            .list('#content > table > tbody > tr > td > div', 'info blocks', true)
            .allElements();

        let artistParser: ParseElement;
        // iterate through content blocks, detect favorite artists header, grab artists
        let artistTitleBlockIsNext = false;
        for (const blockParser of unserInfoBlockParsers) {
            if(artistTitleBlockIsNext) {
                artistParser = blockParser;
                artistTitleBlockIsNext = false;
            }
            if(blockParser.textContent() === 'favorite artists') {
                artistTitleBlockIsNext = true;
            }
        }
        if(artistParser) {
            let totalArtists = 0;
            artistParser
                .list('div > a', 'favorite artists', true)
                .allElements('artists')
                .forEach((artist): void => {
                    let artistLink = artist.href(false);
                    artistLink = encodeURI(artistLink);
                    if(artistLink != null && artistLink !== '' && artistLink.split('/')[1] === 'artist') {
                        this.favoriteArtists.push(
                            new ArtistScraper(`https://rateyourmusic.com${artistLink}`),
                        );
                        totalArtists += 1;
                    }
                });
            if(totalArtists === 0) {
                throw new Error(`User ${this.name}'s favorite artists block contains no links`);
            }
        } else {
            throw new Error(`User ${this.name} has no "favorite artists" section`);
        }
    }

    /**
     * Extracts and stores (from example raw element text: ```Male / 33```)
     * - [[ProfileScraper.age]]
     * - [[ProfileScraper.gender]]
     */
    private extractUserInfo(): void {
        const userAgeAndGenderRaw = this.scrapeRoot
            .element('.profilehii > table > tbody > tr:nth-child(2) > td', 'age/gender', false)
            .textContent(false, null);
        if(userAgeAndGenderRaw != null && userAgeAndGenderRaw.split(' / ').length > 1) {
            const splitUserInfo: string[] = userAgeAndGenderRaw.split(' / ');
            this.age = Number(splitUserInfo[0]);
            this.gender = (splitUserInfo[1] === 'Male');
        } else {
            this.age = null;
            this.gender = null;
        }
    }

    public async getEntity(): Promise<ProfileEntity> {
        return this.repository.findOne({ name: this.name });
    }

    public printInfo(): void {
        Log.log(`Username: ${this.name}`);
        Log.log(`Age: ${this.age}`);
        Log.log(`Gender: ${this.gender ? 'Male' : 'Female'}`);
    }

    public async saveToLocal(): Promise<void> {
        // extract artist db records, ignoring duplicates
        const artistEntities: ArtistEntity[] = [];
        const artistEntityIds: number[] = [];
        for await(const artist of this.favoriteArtists) {
            const artistEntity = await artist.getEntity();
            if(artistEntity != null && artistEntityIds.indexOf(artistEntity.id) === -1) {
                artistEntities.push(artistEntity);
                artistEntityIds.push(artistEntity.id);
            }
        }

        let profile = await this.getEntity();
        if(profile == null) profile = new ProfileEntity();

        profile.name = this.name;
        profile.age = this.age;
        profile.gender = this.gender;
        profile.urlRYM = this.url;
        profile.favoriteArtists = artistEntities;

        profile = await this.repository.save(profile);
        this.databaseId = profile.id;
    }

    /**
     * Scrape the user's favorite artists
     */
    protected async scrapeDependencies(): Promise<void> {
        const res = await ProfileScraper.scrapeDependencyArr<ArtistScraper>(this.favoriteArtists);
        this.favoriteArtists = res.scrapers;
        this.results.concat(res.results);
    }
}
