import {
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";

const token = process.env.GITHUB_TOKEN;
const username = process.env.GH_USERNAME || "Shreya11G";
const readmePath = process.env.README_PATH || "README.md";
const maxPRs = Number(process.env.MAX_PRS || 10);

const START_MARKER = "<!--START_MERGED_PRS-->";
const END_MARKER = "<!--END_MERGED_PRS-->";

const GRAPHQL_URL = "https://api.github.com/graphql";
const REST_URL = "https://api.github.com";
const ASSETS_DIR = "assets";

const PINK = "#FF69B4";
const HOT_PINK = "#FF1493";
const DARK = "#0D0A0D";
const CARD = "#171117";
const BORDER = "#4A1E3A";
const MUTED = "#B8A6B1";
const TEXT = "#FFF0F7";

if (!token) {
  throw new Error("GITHUB_TOKEN is not available.");
}

mkdirSync(ASSETS_DIR, { recursive: true });

async function githubRest(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Shreya11G-profile-updater",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub REST API ${response.status}: ${text}`);
  }

  return response.json();
}

async function githubGraphQL(query, variables = {}) {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Shreya11G-profile-updater",
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await response.json();

  if (!response.ok || data.errors) {
    throw new Error(
      `GitHub GraphQL API error: ${JSON.stringify(data.errors || data)}`
    );
  }

  return data.data;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function shortNumber(value) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

async function fetchProfile() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        login
        name
        followers { totalCount }
        repositories(first: 100, ownerAffiliations: OWNER) {
          totalCount
        }
        contributionsCollection {
          totalCommitContributions
          totalPullRequestContributions
          totalIssueContributions
          totalRepositoryContributions
          restrictedContributionsCount
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const data = await githubGraphQL(query, { login: username });
  return data.user;
}

async function fetchRepositories() {
  const repositories = [];
  let page = 1;

  while (true) {
    const url =
      `${REST_URL}/users/${username}/repos` +
      `?per_page=100&page=${page}&type=owner&sort=updated`;

    const data = await githubRest(url);
    repositories.push(...data);

    if (data.length < 100) break;
    page++;
  }

  return repositories;
}

async function fetchPullRequests() {
  const query = encodeURIComponent(`is:pr author:${username}`);
  const url =
    `${REST_URL}/search/issues?q=${query}` +
    `&sort=updated&order=desc&per_page=100`;

  const data = await githubRest(url);
  return data.items || [];
}

async function fetchMergedPullRequests() {
  const query = encodeURIComponent(
    `is:pr author:${username} is:merged`
  );

  const url =
    `${REST_URL}/search/issues?q=${query}` +
    `&sort=updated&order=desc&per_page=100`;

  const data = await githubRest(url);
  return data.items || [];
}

async function fetchLanguageStats(repositories) {
  const languageBytes = new Map();

  for (const repo of repositories) {
    if (repo.fork) continue;

    try {
      const languages = await githubRest(
        `${REST_URL}/repos/${repo.full_name}/languages`
      );

      for (const [language, bytes] of Object.entries(languages)) {
        languageBytes.set(
          language,
          (languageBytes.get(language) || 0) + bytes
        );
      }
    } catch (error) {
      console.warn(`Could not fetch languages for ${repo.full_name}`);
    }
  }

  const entries = [...languageBytes.entries()]
    .sort((a, b) => b[1] - a[1]);

  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);

  return entries.map(([language, bytes]) => ({
    language,
    bytes,
    percentage: total > 0 ? (bytes / total) * 100 : 0,
  }));
}

function svgStart(width, height, title) {
  return `
<svg xmlns="http://www.w3.org/2000/svg"
  width="${width}" height="${height}"
  viewBox="0 0 ${width} ${height}">
<defs>
  <filter id="pinkGlow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="5" result="blur"/>
    <feMerge>
      <feMergeNode in="blur"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>

  <filter id="strongPinkGlow" x="-100%" y="-100%" width="300%" height="300%">
    <feGaussianBlur stdDeviation="9" result="blur"/>
    <feMerge>
      <feMergeNode in="blur"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>

  <linearGradient id="pinkGradient" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="${PINK}"/>
    <stop offset="50%" stop-color="#FFC1E1"/>
    <stop offset="100%" stop-color="${HOT_PINK}"/>
  </linearGradient>
</defs>

<rect width="100%" height="100%" rx="18"
  fill="${DARK}" stroke="${BORDER}" stroke-width="1"/>

<text x="35" y="42" fill="${TEXT}"
  font-family="Arial, sans-serif" font-size="22" font-weight="700">
  ${escapeXml(title)}
</text>
`;
}

function svgEnd() {
  return "</svg>";
}

function bar({ x, y, width, height, value, max, color = PINK }) {
  const calculatedWidth = max > 0 ? (value / max) * width : 0;

  return `
<rect x="${x}" y="${y}" width="${width}" height="${height}"
  rx="6" fill="${CARD}" stroke="${BORDER}"/>

<rect x="${x}" y="${y}"
  width="${Math.max(calculatedWidth, 2)}" height="${height}"
  rx="6" fill="${color}" filter="url(#pinkGlow)"/>
`;
}

function generateAnalyticsSVG({ profile, repositories, prs, mergedPRs }) {
  const totalStars = repositories.reduce(
    (sum, repo) => sum + repo.stargazers_count, 0
  );

  const commits =
    profile.contributionsCollection.totalCommitContributions;

  const width = 1100;
  const height = 390;

  let svg = svgStart(width, height, "GitHub Analytics");

  const cards = [
    { label: "Repositories", value: profile.repositories.totalCount },
    { label: "Followers", value: profile.followers.totalCount },
    { label: "Commits", value: commits },
    { label: "Pull Requests", value: prs.length },
    { label: "Merged PRs", value: mergedPRs.length },
    { label: "Stars", value: totalStars },
  ];

  cards.forEach((card, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 35 + col * 350;
    const y = 75 + row * 140;

    svg += `
<rect x="${x}" y="${y}" width="310" height="110"
  rx="14" fill="${CARD}" stroke="${BORDER}"/>

<text x="${x + 22}" y="${y + 35}"
  fill="${MUTED}" font-family="Arial" font-size="14">
  ${escapeXml(card.label)}
</text>

<text x="${x + 22}" y="${y + 78}"
  fill="${PINK}" filter="url(#pinkGlow)"
  font-family="Arial" font-size="30" font-weight="700">
  ${escapeXml(shortNumber(card.value))}
</text>
`;
  });

  svg += svgEnd();

  writeFileSync(
    `${ASSETS_DIR}/github-analytics.svg`,
    svg,
    "utf8"
  );
}

function generateContributionGraph(profile) {
  const days =
    profile.contributionsCollection.contributionCalendar.weeks
      .flatMap((week) => week.contributionDays);

  const width = 1100;
  const height = 360;
  const cell = 13;
  const gap = 4;
  const startX = 45;
  const startY = 80;

  const max =
    Math.max(...days.map((day) => day.contributionCount)) || 1;

  let svg = svgStart(width, height, "Contribution Activity");

  days.forEach((day, index) => {
    const week = Math.floor(index / 7);
    const weekday = index % 7;

    const x = startX + week * (cell + gap);
    const y = startY + weekday * (cell + gap);
    const ratio = day.contributionCount / max;

    let fill = "#160D13";

    if (ratio > 0.75) fill = HOT_PINK;
    else if (ratio > 0.5) fill = "#FF4FA3";
    else if (ratio > 0.25) fill = "#C52B78";
    else if (ratio > 0) fill = "#6D1742";

    const glow =
      ratio > 0.5 ? 'filter="url(#pinkGlow)"' : "";

    svg += `
<rect x="${x}" y="${y}" width="${cell}" height="${cell}"
  rx="3" fill="${fill}" ${glow}>
  <title>${escapeXml(day.date)}: ${day.contributionCount} contributions</title>
</rect>
`;
  });

  svg += `
<text x="45" y="320" fill="${MUTED}"
  font-family="Arial" font-size="14">
  Total contributions:
</text>

<text x="180" y="320" fill="${PINK}"
  filter="url(#pinkGlow)"
  font-family="Arial" font-size="16" font-weight="700">
  ${profile.contributionsCollection.contributionCalendar.totalContributions}
</text>
`;

  svg += svgEnd();

  writeFileSync(
    `${ASSETS_DIR}/contribution-graph.svg`,
    svg,
    "utf8"
  );
}

function generateLanguageGraph(languageStats) {
  const width = 1100;
  const height = 500;

  let svg = svgStart(
    width,
    height,
    "Repository Language Distribution"
  );

  const visible = languageStats.slice(0, 8);
  const max =
    Math.max(...visible.map((item) => item.percentage)) || 1;

  visible.forEach((item, index) => {
    const y = 75 + index * 48;

    svg += `
<text x="40" y="${y + 20}"
  fill="#F5F5F5" font-family="Arial" font-size="14">
  ${escapeXml(item.language)}
</text>

${bar({
  x: 190,
  y,
  width: 650,
  height: 24,
  value: item.percentage,
  max,
})}

<text x="860" y="${y + 19}"
  fill="${PINK}" font-family="Arial"
  font-size="14" font-weight="700">
  ${item.percentage.toFixed(1)}%
</text>
`;
  });

  svg += svgEnd();

  writeFileSync(
    `${ASSETS_DIR}/language-graph.svg`,
    svg,
    "utf8"
  );
}

function generatePRGraph(prs) {
  const width = 1100;
  const height = 400;
  const months = new Map();

  for (const pr of prs) {
    const date = pr.created_at || pr.updated_at;
    if (!date) continue;

    const d = new Date(date);

    const key =
      `${d.getUTCFullYear()}-${String(
        d.getUTCMonth() + 1
      ).padStart(2, "0")}`;

    months.set(key, (months.get(key) || 0) + 1);
  }

  const values = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12);

  const max =
    Math.max(...values.map(([, value]) => value)) || 1;

  let svg = svgStart(width, height, "Pull Request Activity");

  const chartX = 70;
  const chartY = 80;
  const chartWidth = 950;
  const chartHeight = 240;

  svg += `
<line x1="${chartX}" y1="${chartY + chartHeight}"
  x2="${chartX + chartWidth}" y2="${chartY + chartHeight}"
  stroke="${BORDER}"/>

<line x1="${chartX}" y1="${chartY}"
  x2="${chartX}" y2="${chartY + chartHeight}"
  stroke="${BORDER}"/>
`;

  const points = [];

  values.forEach(([month, value], index) => {
    const x =
      chartX +
      (index / Math.max(values.length - 1, 1)) *
        chartWidth;

    const y =
      chartY +
      chartHeight -
      (value / max) * chartHeight;

    points.push(`${x},${y}`);

    svg += `
<circle cx="${x}" cy="${y}" r="6"
  fill="${PINK}" filter="url(#strongPinkGlow)">
  <title>${escapeXml(month)}: ${value} PRs</title>
</circle>

<text x="${x}" y="${chartY + chartHeight + 28}"
  fill="#A7AAB5" font-family="Arial" font-size="12"
  text-anchor="middle">
  ${escapeXml(month)}
</text>
`;
  });

  if (points.length > 1) {
    svg += `
<polyline points="${points.join(" ")}"
  fill="none" stroke="${PINK}"
  filter="url(#pinkGlow)"
  stroke-width="4" stroke-linecap="round"
  stroke-linejoin="round"/>
`;
  }

  svg += svgEnd();

  writeFileSync(
    `${ASSETS_DIR}/pr-activity.svg`,
    svg,
    "utf8"
  );
}

function buildMergedPRMarkdown(mergedPRs, prs) {
  const sorted = [...mergedPRs]
    .sort(
      (a, b) =>
        new Date(b.closed_at || b.updated_at) -
        new Date(a.closed_at || a.updated_at)
    )
    .slice(0, maxPRs);

  if (sorted.length === 0) {
    return `
<div align="center">

**🔀 ${prs.length} Total PRs**
&nbsp;&nbsp; • &nbsp;&nbsp;
**🩷 0 Merged PRs**

</div>
`;
  }

  const rows = sorted
    .map((pr) => {
      const title = pr.title || "Untitled Pull Request";

      return `
<tr>
<td>

**${escapeXml(title)}**

</td>

<td align="right">
<a href="${escapeXml(pr.html_url)}">
<img src="https://img.shields.io/badge/VIEW-FF69B4?style=flat-square&logo=github&logoColor=000000" />
</a>
</td>
</tr>
`;
    })
    .join("\n");

  return `
<div align="center">

**🔀 ${prs.length} Total PRs**
&nbsp;&nbsp; • &nbsp;&nbsp;
**🩷 ${mergedPRs.length} Merged PRs**

</div>

<table width="100%">

${rows}

</table>

<div align="center">

<sub>
Showing latest ${sorted.length} of ${mergedPRs.length} merged pull requests
&nbsp; • &nbsp;
</sub>

</div>
`;
}

function updateReadme(markdown) {
  const original = readFileSync(readmePath, "utf8");

  if (
    !original.includes(START_MARKER) ||
    !original.includes(END_MARKER)
  ) {
    throw new Error(
      `README.md must contain ${START_MARKER} and ${END_MARKER}`
    );
  }

  const start = original.indexOf(START_MARKER);
  const end = original.indexOf(END_MARKER, start);

  if (end === -1) {
    throw new Error("Invalid README marker order.");
  }

  const before = original.slice(0, start);
  const after = original.slice(end + END_MARKER.length);

  const updated =
    before +
    START_MARKER +
    "\n" +
    markdown.trim() +
    "\n" +
    END_MARKER +
    after;

  writeFileSync(readmePath, updated, "utf8");
}

async function main() {
  console.log(`Updating GitHub profile for ${username}...`);

  const [
    profile,
    repositories,
    prs,
    mergedPRs,
  ] = await Promise.all([
    fetchProfile(),
    fetchRepositories(),
    fetchPullRequests(),
    fetchMergedPullRequests(),
  ]);

  const languageStats =
    await fetchLanguageStats(repositories);

  generateAnalyticsSVG({
    profile,
    repositories,
    prs,
    mergedPRs,
  });

  generateContributionGraph(profile);
  generateLanguageGraph(languageStats);
  generatePRGraph(prs);

  const mergedMarkdown =
    buildMergedPRMarkdown(mergedPRs, prs);

  updateReadme(mergedMarkdown);

  console.log("GitHub profile updated successfully.");
}

main().catch((error) => {
  console.error("Failed to update GitHub profile");
  console.error(error);
  process.exit(1);
});
