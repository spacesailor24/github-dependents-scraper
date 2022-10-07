import * as puppeteer from "puppeteer";
import { readFileSync, writeFileSync } from "fs";
import { exit } from "process";
import { isDeepStrictEqual } from "util";

interface Dependent {
  owner: string;
  repo: string;
  stars: number;
  forks: number;
  previousGithubDependentsPageUrl: string | null;
}

async function getDependentsFromFile(dependentsFile: string) {
  return JSON.parse(
    await readFileSync(dependentsFile, { encoding: "utf8" })
  ) as Dependent[];
}

async function saveDependentsToFile(
  dependentsFile: string,
  dependents: Dependent[],
  overwriteDependentsFile: Boolean
) {
  console.log(
    `Saving ${dependents.length} found dependents to ${dependentsFile}...`
  );

  let _dependents = dependents;
  if (!overwriteDependentsFile) {
    const existingDependents = await getDependentsFromFile(dependentsFile);
    _dependents = existingDependents.concat(dependents);
  }

  await writeFileSync(dependentsFile, JSON.stringify(_dependents));
}

async function parseDependents(page: puppeteer.Page) {
  try {
    const dependents: Dependent[] = [];

    let element: puppeteer.ElementHandle<Element> | null;
    try {
      element = await page.waitForSelector("#dependents > div.Box", {
        timeout: 15000,
      });
    } catch (error) {
      throw new Error(
        "Unable to find dependents, probably reached rate limit page," +
          "try running crawler again in a few minutes with resumeCrawler = true.\n" +
          '**NOTE** Running script again without passing "true" for resumeCrawler will' +
          "overwrite dependentsFile if same file name is used. Recommend use is to use" +
          "same file name for dependentsFile and pass true as third argument when starting crawler.\n" +
          "Exiting..."
      );
    }

    const numberOfDependents = (await page.evaluate(
      (el) => el?.childElementCount,
      element
    )) as number;

    // -1 Because containing div has a header div we don't want
    // #dependents > div.Box > div.Box-header.clearfix
    console.log(`Found ${numberOfDependents - 1} dependents, parsing them...`);

    for (let index = 2; index <= numberOfDependents; index++) {
      let text: string = "";

      try {
        const element = await page.waitForSelector(
          `#dependents > div.Box > div:nth-child(${index})`
        );
        text = (await page.evaluate(
          (el) => el?.textContent,
          element
        )) as string;
        const reg = /(\S+\s\/)(\s+\S+)\s+((?:\d+,?)+)(\s+)((?:\d+,?)+)/;
        const res = reg.exec(text as string) as string[];
        dependents.push({
          owner: res[1].replace(/\s\//g, ""),
          repo: res[2].replace(/\s/g, ""),
          stars: parseInt(res[3].replace(/,/g, "")),
          forks: parseInt(res[5].replace(/,/g, "")),
          previousGithubDependentsPageUrl: null,
        });
      } catch (error) {
        console.error(error);
        console.log(text);
      }
    }

    return dependents;
  } catch (error) {
    console.error(error);
    await page.screenshot({ path: "./screenshot.jpg" });
  }
}

async function getPreviousDependentsPageUrl(page: puppeteer.Page) {
  let element: puppeteer.ElementHandle<Element> | null;

  try {
    element = await page.waitForSelector(
      "#dependents > div.paginate-container > div > a:nth-child(1)",
      { timeout: 15000 }
    );
  } catch (error) {
    try {
      element = await page.waitForSelector(
        "#dependents > div.paginate-container > div > button",
        { timeout: 15000 }
      );
    } catch (error) {
      throw new Error(
        'Unable to find "Previous" button to go to previous dependents page'
      );
    }
  }

  return await page.evaluate((el) => {
    // We're on the first dependencies page
    if (el?.getAttribute("disabled") === "disabled") return null;

    return el?.getAttribute("href");
  }, element);
}

async function getNextDependentsPageUrl(page: puppeteer.Page) {
  let element: puppeteer.ElementHandle<Element> | null;

  try {
    element = await page.waitForSelector(
      "#dependents > div.paginate-container > div > a:nth-child(2)",
      { timeout: 15000 }
    );
  } catch (error) {
    try {
      // We are at the last dependents page
      if ((await getPreviousDependentsPageUrl(page)) !== null) return null;

      element = await page.waitForSelector(
        "#dependents > div.paginate-container > div > a",
        { timeout: 15000 }
      );
    } catch (error) {
      throw new Error(
        'Unable to find "Next" button to go to next dependents page'
      );
    }
  }

  return await page.evaluate((el) => {
    // We're on the last dependencies page
    if (el?.getAttribute("disabled") === "disabled") return null;

    return el?.getAttribute("href");
  }, element);
}

async function removeDuplicateDependents(
  dependentsFile: string,
  parsedDependents: Dependent[]
) {
  const _parsedDependents = parsedDependents;
  const existingDependents = await getDependentsFromFile(dependentsFile);
  for (const [index, parsedDependent] of parsedDependents.entries()) {
    if (
      existingDependents.findIndex((dependent) =>
        isDeepStrictEqual(dependent, parsedDependent)
      ) !== -1
    ) {
      console.log("Found duplicate dependent when parsing, skipping it...");
      _parsedDependents.splice(index, 1);
    }
  }

  return _parsedDependents;
}

async function startCrawl(
  dependentsFile: string,
  page: puppeteer.Page,
  overwriteDependentsFile = false
) {
  let _overwriteDependentsFile = overwriteDependentsFile;

  console.log("Starting crawl...");

  try {
    while (true) {
      let parsedDependents = await parseDependents(page);
      if (parsedDependents === undefined)
        throw new Error("Unable to parse dependents");

      try {
        parsedDependents = await removeDuplicateDependents(
          dependentsFile,
          parsedDependents
        );
      } catch (error) {
        throw error;
      }

      const previousPageUrl = await getPreviousDependentsPageUrl(page);
      if (previousPageUrl !== null && previousPageUrl !== undefined) {
        for (const dependent of parsedDependents) {
          dependent.previousGithubDependentsPageUrl = previousPageUrl;
        }
      }

      await saveDependentsToFile(
        dependentsFile,
        parsedDependents,
        _overwriteDependentsFile
      );
      // We are saving after parsing each page, so we no longer want to overwrite
      // the dependentsFile if overwriteDependentsFile was true
      _overwriteDependentsFile = false;

      const nextPageUrl = await getNextDependentsPageUrl(page);
      if (nextPageUrl === null) {
        console.log("Reached last dependency page, exiting...");
        break;
      } else if (nextPageUrl === undefined)
        throw new Error("Unable to find next dependency page URL");

      await page.goto(nextPageUrl);
    }
  } catch (error) {
    console.error(error);
  }
}

async function resumeCrawlFromFile(
  dependentsFile: string,
  page: puppeteer.Page
) {
  console.log(`Resuming crawl from last dependent in ${dependentsFile}...`);
  const dependentsFileJson = await getDependentsFromFile(dependentsFile);
  const lastDependent = dependentsFileJson.pop();

  if (lastDependent === undefined)
    throw new Error(`${dependentsFile} appears to be empty`);

  if (lastDependent.previousGithubDependentsPageUrl !== null) {
    await page.goto(lastDependent.previousGithubDependentsPageUrl);

    const nextPageUrl = await getNextDependentsPageUrl(page);
    if (nextPageUrl === null) {
      console.log("Reached last dependency page, exiting...");
      exit(0);
    }
    if (nextPageUrl === undefined) {
      throw new Error("Unable to find next dependency page URL");
    }
    await page.goto(nextPageUrl);
  }

  await startCrawl(dependentsFile, page);
}

async function launchPuppeteer(): Promise<[puppeteer.Browser, puppeteer.Page]> {
  const browser = await puppeteer.launch({});
  const page = await browser.newPage();
  return [browser, page];
}

function getArgs(): [string, string, boolean] {
  const [githubOwnerAndRepo, dependentsFile, resumeCrawl] =
    process.argv.slice(2);

  if (
    githubOwnerAndRepo === undefined ||
    githubOwnerAndRepo.match(/(\S+\/\S+)/) === null
  )
    throw new Error(
      `Unable to parse Github Owner and Repo names from ${githubOwnerAndRepo}. ` +
        `Please provide Owner and Repo names like so: owner/repo`
    );

  if (dependentsFile === undefined || !dependentsFile.match(/\w+.json/))
    throw new Error(
      `Expected dependents file to have .json extension. ${dependentsFile} was provided`
    );

  if (
    resumeCrawl !== "false" &&
    resumeCrawl !== "true" &&
    resumeCrawl !== undefined
  )
    throw new Error(
      `Expected resumeCrawl to be true or false. ${resumeCrawl} was provided`
    );

  return [githubOwnerAndRepo, dependentsFile, Boolean(resumeCrawl)];
}

async function start() {
  const [githubOwnerAndRepo, dependentsFile, resumeCrawl] = getArgs();

  console.log(`Scrapping dependents for ${githubOwnerAndRepo}`);
  console.log(`Saving dependents to ${dependentsFile}`);

  const [browser, page] = await launchPuppeteer();

  if (resumeCrawl) await resumeCrawlFromFile(dependentsFile, page);
  else {
    await page.goto(
      `https://github.com/${githubOwnerAndRepo}/network/dependents`
    );
    await saveDependentsToFile(dependentsFile, [], true);
    await startCrawl(dependentsFile, page, true);
  }

  browser.close();
}

(async () => {
  start();
})();
