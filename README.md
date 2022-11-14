# Github Dependents Scraper

This is designed to scrape the data from the Github [dependency graph](https://github.com/libp2p/js-libp2p/network/dependents) page into a JSON file

### Getting Started

#### Prerequisites

- Install `yarn`

1. Clone the repo
2. Run `yarn` - Installs dependencies
3. Run `npx tsc` - Compiles `index.ts`
4. Create a blank `dependents.json` file with an empty object `{}` contained inside the file
5. Run the scrapper `node index.js repoOwner/repo dependents.json`
    - The command line arguments for the scrapper are as follows:
        1. (`githubOwnerAndRepo`) `repoOwner/repo` - This is what's displayed in the Github URL when on the repo page e.g. for this repo it would be `spacesailor24/github-dependents-scraper`
        2. (`dependentsFile`) `anything.json` - This file can be named anything, but it needs to be a valid JSON file ending with the `.json` file extension
        3. (`resumeCrawl`) `true` or `false` - Eventually this crawler will get rate limited by Github, this flag allows you to run the crawler from where it left off before receiving the rate limit page. Do not use when first initializing the scrape. Only apply `true` when continuing the scrape from an incomplete state.
            - So if the crawler dies because of rate limiting, you'd start it up again with:
            ```bash
            node index.js repoOwner/repo dependents.json true
            ```
            **NOTE** Starting it with `false` will override the `dependentsFile` and start scrapping from the first dependents page

### Sorting the Scrapped Data

Maybe I'll extend crawler to be able to sort the data, but for now, there's a nifty [online sorter](https://codeshack.io/json-sorter/) that'll do the trick!
