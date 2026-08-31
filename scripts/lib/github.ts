/* Everything the card puts on screen, fetched once.
 *
 * Two APIs, because they answer different questions and only one of them
 * needs a real token:
 *
 *   GraphQL  contributions. There is no unauthenticated way to ask how many
 *            contributions somebody made this year, so this is the half that
 *            needs STATS_TOKEN (a fine-grained PAT with read:user).
 *   REST     repositories, stars, followers, languages, and tonil's releases.
 *            All public, so all of it works with no token at all.
 *
 * The split is deliberate rather than incidental: `bun run generate` has to be
 * runnable on a laptop with no secret in the environment, or the only way to
 * see what the card looks like is to push and wait for a workflow. Without a
 * token the contributions row is simply absent and everything else is real.
 */

export interface LanguageShare {
  name: string;
  /** Fraction of the mix, 0-1. Repo-weighted, not byte-weighted - see below. */
  share: number;
}

export interface Stats {
  login: string;
  repos: number;
  stars: number;
  followers: number;
  /** Null when there was no token to ask with. */
  contributions: number | null;
  languages: LanguageShare[];
  latest: { name: string; pushedAt: string } | null;
  sshCvVersion: string | null;
  generatedAt: string;
}

const API = "https://api.github.com";

interface Repo {
  name: string;
  stargazers_count: number;
  fork: boolean;
  archived: boolean;
  pushed_at: string;
  languages_url: string;
}

function headers(token?: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "riptone-profile-generator",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * A refusal that will affect every other request too.
 *
 * Distinguished from an ordinary failure because the two want opposite
 * handling, and getting that wrong is how this script quietly lied. Rate
 * limiting is global and sticky: once the budget is gone, every remaining
 * call fails the same way. The per-repo `catch` below was written for "this
 * one repository is unreadable" and, by catching everything, turned "GitHub
 * is refusing all of it" into a language breakdown assembled from whichever
 * requests happened to land before the limit hit - which renders as a
 * perfectly plausible card full of wrong percentages.
 *
 * Unauthenticated callers get 60 requests an hour, which two runs of this
 * script can exhaust. That is not a hypothetical: it is how this was found.
 */
export class RateLimited extends Error {
  constructor(
    readonly path: string,
    readonly resetsAt: Date | null,
  ) {
    const when = resetsAt
      ? ` Resets at ${resetsAt.toISOString().slice(11, 19)}Z.`
      : "";
    super(
      `GitHub is rate-limiting this token (at ${path}).${when}` +
        " Refusing to render a card from partial data - set STATS_TOKEN," +
        " or wait.",
    );
    this.name = "RateLimited";
  }
}

function rateLimitOf(response: Response, path: string): RateLimited | null {
  // 429 is explicit. A 403 is only rate limiting when the budget is actually
  // spent - a 403 with requests remaining is a permissions problem, which is
  // a different bug and should not be reported as this one.
  const remaining = response.headers.get("x-ratelimit-remaining");
  const limited =
    response.status === 429 || (response.status === 403 && remaining === "0");
  if (!limited) return null;

  const reset = Number(response.headers.get("x-ratelimit-reset"));
  return new RateLimited(
    path,
    Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : null,
  );
}

async function rest<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: headers(token) });
  if (!response.ok) {
    const limited = rateLimitOf(response, path);
    if (limited) throw limited;
    throw new Error(`GET ${path}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

/**
 * Total contributions over the trailing year.
 *
 * `contributionCalendar.totalContributions` is the number GitHub's own profile
 * graph shows, which is the one worth printing - the obvious alternative,
 * `totalCommitContributions`, excludes issues, reviews and PRs and so reads as
 * suspiciously low next to the graph it sits under.
 *
 * Returns null rather than throwing on any failure. An expired token should
 * cost the card one row, not the whole run.
 */
async function fetchContributions(
  login: string,
  token: string,
): Promise<number | null> {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar { totalContributions }
        }
      }
    }`;

  try {
    const response = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { login } }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      data?: {
        user?: {
          contributionsCollection?: {
            contributionCalendar?: { totalContributions?: number };
          };
        };
      };
      errors?: unknown;
    };
    if (body.errors) return null;
    return (
      body.data?.user?.contributionsCollection?.contributionCalendar
        ?.totalContributions ?? null
    );
  } catch {
    return null;
  }
}

/**
 * The newest `ssh-cv/v*` release in tonil.
 *
 * Same prefix filter as apps/ssh-cv/scripts/install.sh, and for the same
 * reason: in a monorepo "the newest release" is not the same question as "the
 * newest release of this app". The API returns releases newest first.
 */
async function fetchSshCvVersion(token?: string): Promise<string | null> {
  try {
    const releases = await rest<{ tag_name: string }[]>(
      "/repos/riptone/tonil/releases?per_page=100",
      token,
    );
    const tag = releases.find((release) =>
      release.tag_name.startsWith("ssh-cv/v"),
    );
    return tag ? tag.tag_name.slice("ssh-cv/".length) : null;
  } catch (error) {
    // Not being able to read tonil's releases is survivable - the row is
    // omitted. Being rate-limited is not: it means the numbers above this are
    // suspect too.
    if (error instanceof RateLimited) throw error;
    return null;
  }
}

/**
 * Languages left out of the mix, for two different reasons.
 *
 * **Serialised output.** A single Mathematica notebook is megabytes of saved
 * results, so one university repo full of them measured 82% of everything by
 * bytes - which is how the previous README ended up passing `hide=mathematica`
 * to a third-party stats card. Those bytes were not typed by anyone. Jupyter
 * notebooks are the same shape of lie.
 *
 * **Markup and styling.** HTML, CSS and SCSS are hand-written and are not
 * artefacts, but every web project carries a lot of them, and counting them
 * answers "did you build for the web" - which the repo list already answers -
 * rather than "what do you build in". Leaving them out is what makes the
 * remaining five say something.
 *
 * This is a judgement, not a measurement, which is why it is one list with a
 * comment rather than a threshold.
 */
const EXCLUDED_LANGUAGES = new Set([
  "Mathematica",
  "Jupyter Notebook",
  "HTML",
  "CSS",
  "SCSS",
]);

/**
 * The language mix, largest first, weighted per repository.
 *
 * **Why not bytes.** Summing `languages_url` byte counts across repos is what
 * every stats card does and it is dominated by whichever repository is
 * physically largest - usually one with generated files, vendored assets or
 * notebooks in it. The result describes a directory, not a person.
 *
 * So each repository is normalised to sum to 1 *before* being added up: one
 * repo, one vote, whatever its size. A hundred-line Go service counts as much
 * as a checked-in dataset, which is the intended reading of "what does this
 * person work in".
 *
 * The cost is the opposite bias - a throwaway repo counts as much as a real
 * one - and that is the better error to have when the repos are one person's
 * own.
 */
async function fetchLanguages(
  repos: Repo[],
  token?: string,
  limit = 5,
): Promise<LanguageShare[]> {
  const totals = new Map<string, number>();
  let read = 0;

  // Sequential on purpose. This is one request per repository, and firing
  // eighty at once is how a token ends up secondary-rate-limited - which
  // GitHub answers with a 403 that looks nothing like "slow down".
  for (const repo of repos) {
    try {
      const bytes = await rest<Record<string, number>>(
        new URL(repo.languages_url).pathname,
        token,
      );

      // Excluded before normalising, not after: a repo that is 90% notebooks
      // and 10% Python should read as a Python repo, not as one that barely
      // counts.
      const kept = Object.entries(bytes).filter(
        ([name]) => !EXCLUDED_LANGUAGES.has(name),
      );
      const repoTotal = kept.reduce((sum, [, size]) => sum + size, 0);
      if (repoTotal === 0) continue;

      for (const [name, size] of kept) {
        totals.set(name, (totals.get(name) ?? 0) + size / repoTotal);
      }
      read++;
    } catch (error) {
      // One unreadable repository should not cost the whole breakdown - but
      // rate limiting is not one repository, it is all of the remaining ones,
      // and swallowing it here is what produced a card of confident nonsense.
      if (error instanceof RateLimited) throw error;
    }
  }

  // Belt and braces for the failure mode above: even without a rate-limit
  // response, a breakdown built from a third of the repositories is not a
  // breakdown. Better to fail the run than to commit it.
  if (read < repos.length * 0.8) {
    throw new Error(
      `only ${read} of ${repos.length} repositories could be read - refusing` +
        " to render a language mix from that",
    );
  }

  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  if (sum === 0) return [];

  const ranked = [...totals.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);

  // Re-normalised across the languages actually shown, so the bar fills its
  // width and the percentages add to 100. Printing shares of a total that
  // includes languages the card does not list leaves a gap at the end of the
  // bar that looks like a rendering bug.
  const shown = ranked.reduce((total, [, weight]) => total + weight, 0);
  return ranked.map(([name, weight]) => ({ name, share: weight / shown }));
}

export async function fetchStats(
  login: string,
  token: string | undefined,
  now: Date,
): Promise<Stats> {
  const user = await rest<{ followers: number; public_repos: number }>(
    `/users/${login}`,
    token,
  );

  const all = await rest<Repo[]>(
    `/users/${login}/repos?per_page=100&sort=pushed`,
    token,
  );

  // Forks are somebody else's code and archived repos are what this person
  // used to write, so neither belongs in a language mix or a star count.
  const counted = all.filter((repo) => !repo.fork && !repo.archived);

  const stars = counted.reduce((sum, repo) => sum + repo.stargazers_count, 0);

  // The profile repository cannot be its own "latest activity".
  //
  // It is the one repo the refresh workflow commits to, every week, seconds
  // before this runs - so it always wins a sort by `pushed_at`, and the row
  // reads "riptone · just now" forever. Which is true, and says nothing: the
  // question the row answers is "what is he actually working on", and the
  // answer can never be the thing that generated the card.
  //
  // Left in the language mix on purpose. The bot writes the commits; the code
  // it commits is still code that was written here.
  const [newest] = [...counted]
    .filter((repo) => repo.name !== login)
    .sort((a, b) => b.pushed_at.localeCompare(a.pushed_at));

  return {
    login,
    repos: user.public_repos,
    stars,
    followers: user.followers,
    contributions: token ? await fetchContributions(login, token) : null,
    languages: await fetchLanguages(counted, token),
    latest: newest ? { name: newest.name, pushedAt: newest.pushed_at } : null,
    sshCvVersion: await fetchSshCvVersion(token),
    generatedAt: now.toISOString(),
  };
}

/** "3 days ago". The card has one line for this, so it says one thing. */
export function relativeTime(iso: string, now: Date): string {
  const seconds = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);

  const units: [string, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];

  for (const [unit, span] of units) {
    if (seconds >= span) {
      const value = Math.floor(seconds / span);
      return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}
