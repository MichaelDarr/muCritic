/**
 * Serves documentation on localhost
 */

// external
import * as dontenv from 'dotenv';
import * as express from 'express';
import { resolve } from 'path';

// environment variables
dontenv.config({ path: resolve(__dirname, '../.env') });

/**
 * Starts a webserver to serve documentation generated by TypeDoc
 *
 * @remarks
 * This is a top-level function, mean to be run directly in the command line:
 * ```
 * npm run serve
 * ```
 * To generate updated documentation, run
 * ```
 * npm run docgen
 * ```
 */
export function serveDocumentation(): void {
    const app = express();
    const port = process.env.DOCUMENTATION_SERVER_PORT;

    app.use(express.static('docs'));

    app.listen(port, (): void => {
        console.log(`Documentation being served on ${port}`);
    });
}

serveDocumentation();