/**
 * Manages scraping of a user's review pages
 */

// library dependencies
import { getManager } from 'typeorm';

// helpers
import { Date } from '../helpers/classes/date';
import { Log } from '../helpers/classes/log';
import { Review } from '../helpers/classes/review';
import { ScrapeResult } from '../helpers/classes/result';
import { requestRawScrape } from '../helpers/functions/scraping';
import {
    extractElementFromElement,
    extractInnerHtmlOfElementFromElement,
} from '../helpers/functions/parsing/base';
import { extractListFromElement } from '../helpers/functions/parsing/list';

// scrapers
import { AbstractScraper } from './abstractScraper';
import { AlbumScraper } from './albumScraper';
import { ProfileScraper } from './profileScraper';

// database dependencies
import { ProfileEntity } from '../entities/ProfileEntity';
import { ReviewEntity } from '../entities/ReviewEntity';

export class ReviewPageScraper extends AbstractScraper {
    private scrapedHtmlElement: HTMLElement;

    public name: string;

    public urlBase: string;

    public currentPage: number;

    public reviews: Review[];

    public profile: ProfileScraper;

    public pageReviewCount: number;

    public sequentialFailureCount: number;

    public constructor(
        profile: ProfileScraper,
        verbose = false,
    ) {
        const urlBase = `https://rateyourmusic.com/collection/${profile.name}/r0.0-5.0/`;
        super(
            `${urlBase}1`,
            'RYM Review Page',
            verbose,
        );
        this.urlBase = urlBase;
        this.currentPage = 1;
        this.reviews = [];
        this.profile = profile;
        this.pageReviewCount = 25;
        this.sequentialFailureCount = 0;
    }

    public async scrapePage(): Promise<void> {
        Log.notify(`Scraping page ${this.currentPage} for user ${this.profile.name}`);
        try {
            this.url = `${this.urlBase}${this.currentPage}`;
            this.reviews = [];
            await this.scrape(true);
            this.currentPage += 1;
            this.sequentialFailureCount = 0;
            Log.notify(`\nReview page scrape Successful!\nPage: ${this.currentPage}\nUser: ${this.profile.name}\n`);
        } catch(e) {
            this.sequentialFailureCount += 1;
        }
    }

    public async getAllReviews(): Promise<ReviewEntity[]> {
        const entityManager = getManager();
        const reviewEntities: ReviewEntity[] = [];
        for await(const review of this.reviews) {
            const entity = await entityManager.findOne(
                ReviewEntity,
                { identifierRYM: review.identifierRYM },
            );
            if(entity) reviewEntities.push(entity);
        }
        return reviewEntities;
    }

    public async getEntity(): Promise<ProfileEntity> {
        return this.profile.getEntity();
    }

    protected async scrapeDependencies(): Promise<void> {
        for await(const review of this.reviews) {
            try {
                await review.album.scrape();
                this.results.concat(review.album.results);
            } catch(e) {
                const failedReviewIndex = this.reviews.indexOf(review);
                if(failedReviewIndex > -1) this.reviews.splice(failedReviewIndex, 1);
                this.results.push(
                    new ScrapeResult(false, this.url, e.message),
                );
            }
        }
    }

    protected async saveToDB(): Promise<ProfileEntity> {
        const entityManager = getManager();
        for await(const review of this.reviews) {
            try {
                let reviewEntity = await entityManager.findOne(
                    ReviewEntity,
                    { identifierRYM: review.identifierRYM },
                );
                if(reviewEntity) continue;
                reviewEntity = new ReviewEntity();
                reviewEntity.album = await review.album.getEntity();
                reviewEntity.profile = await this.profile.getEntity();
                reviewEntity.score = review.score;
                reviewEntity.year = review.date.year;
                reviewEntity.month = review.date.month;
                reviewEntity.day = review.date.day;
                reviewEntity.identifierRYM = review.identifierRYM;
                if(!reviewEntity.album) {
                    throw new Error(`Album not found for review: ${this.name}`);
                }
                if(!reviewEntity.profile) {
                    throw new Error(`Profile not found for album: ${this.name}`);
                }
                reviewEntity = await entityManager.save(reviewEntity);
            } catch(e) {
                this.results.push(new ScrapeResult(false, this.url, `${e.name}: ${e.message}`));
            }
        }
        return this.profile.getEntity();
    }

    protected extractInfo(): void {
        const parsedReviewArr: string[][] = [];
        const reviewElements = extractListFromElement(
            this.scrapedHtmlElement,
            'table.mbgen > tbody > tr',
            false,
            'RYM review table',
        );
        this.pageReviewCount = reviewElements.length;
        let isHeading = true;
        reviewElements.forEach((reviewElement: HTMLElement): void => {
            if(isHeading) {
                isHeading = false;
                return;
            }

            try {
                const dateElement: HTMLElement = reviewElement.querySelector('td.or_q_rating_date_d');
                const month: string = extractInnerHtmlOfElementFromElement(
                    dateElement,
                    'div.date_element_month',
                    true,
                    'RYM review month',
                );
                const day: string = extractInnerHtmlOfElementFromElement(
                    dateElement,
                    'div.date_element_day',
                    true,
                    'RYM review day',
                );
                const year: string = extractInnerHtmlOfElementFromElement(
                    dateElement,
                    'div.date_element_year',
                    true,
                    'RYM review year',
                );

                const starsElement = extractElementFromElement(
                    this.scrapedHtmlElement,
                    'td.or_q_rating_date_s > img',
                    true,
                );
                const starsText: string = starsElement.title;
                const starsTextArr: string[] = starsText.split(' ');
                const starsCount: string = starsTextArr[0];

                const identifierRYM = extractInnerHtmlOfElementFromElement(
                    reviewElement,
                    'td.or_q_rating_date_s > span',
                    true,
                    'RYM review unique identifier',
                );

                const albumLinkPartial: string = extractInnerHtmlOfElementFromElement(
                    reviewElement,
                    'td.or_q_albumartist_td > div.or_q_albumartist > i > a.album',
                    true,
                    'RYM review album link',
                );

                parsedReviewArr.push([
                    month,
                    day,
                    year,
                    starsCount,
                    `https://rateyourmusic.com${encodeURI(albumLinkPartial)}`,
                    identifierRYM,
                ]);
            } catch(e) {
                Log.err('Failed to extract data from review element.');
            }
        });

        for (const singleReview of parsedReviewArr) {
            const reviewDate = new Date(
                singleReview[0],
                Number(singleReview[1]),
                Number(singleReview[2]),
            );
            const reviewScore = Number(singleReview[3]);
            const album = new AlbumScraper(singleReview[4]);
            const identifierRYM = singleReview[5];
            const newReview = new Review(
                album,
                this.profile,
                reviewScore,
                identifierRYM,
                reviewDate,
            );
            this.reviews.push(newReview);
        }
    }

    public async requestScrape(): Promise<void> {
        this.scrapedHtmlElement = await requestRawScrape(this.url);
    }

    public printInfo(): void {
        Log.log(`Profile: ${this.profile.name}`);
        Log.log(`Pages: ${this.currentPage}`);
    }
}