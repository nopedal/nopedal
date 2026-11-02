// Collects a contribution year and language mix from the GitHub GraphQL API.
// Token: GITHUB_TOKEN or GH_TOKEN, else `gh auth token`.
// The contribution calendar includes private work when the profile shows
// private contributions. Languages only cover repositories the token can read.

import { execFileSync } from 'node:child_process'
import type { Day, Language, Snapshot } from './render.ts'

const CALENDAR = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`
const REPOS = `query($login:String!,$cursor:String){user(login:$login){repositories(first:100,after:$cursor,ownerAffiliations:OWNER,isFork:false){pageInfo{hasNextPage endCursor}nodes{languages(first:20,orderBy:{field:SIZE,direction:DESC}){edges{size node{name color}}}}}}}`

function token(): string {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (t) return t
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
  } catch {
    throw new Error('No token. Set GITHUB_TOKEN or log in with `gh auth login`.')
  }
}

async function gql<T>(query: string, variables: Record<string, unknown>, tk: string): Promise<T> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${tk}`, 'Content-Type': 'application/json', 'User-Agent': 'lauv' },
    body: JSON.stringify({ query, variables }),
  })
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> }
  if (!res.ok || body.errors?.length) throw new Error(body.errors?.map((e) => e.message).join('; ') || `GitHub API ${res.status}`)
  return body.data as T
}

const HISTORY = `query($owner:String!,$name:String!,$since:GitTimestamp!,$cursor:String){repository(owner:$owner,name:$name){defaultBranchRef{target{... on Commit{history(since:$since,first:100,after:$cursor){pageInfo{hasNextPage endCursor}nodes{committedDate}}}}}}}`

/** Commits per day on a repository's default branch over the last year, as a Day[] like the calendar. */
export async function collectRepo(fullName: string, opts: { today?: string } = {}): Promise<Day[]> {
  const tk = token()
  const [owner, name] = fullName.split('/')
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const start = new Date(Date.parse(today + 'T00:00:00Z') - 365 * 86400000)
  const counts = new Map<string, number>()
  type Hist = { repository: { defaultBranchRef: { target: { history: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Array<{ committedDate: string }> } } } | null } | null }
  let cursor: string | null = null
  for (let page = 0; page < 200; page++) {
    const r: Hist = await gql<Hist>(HISTORY, { owner, name, since: start.toISOString(), cursor }, tk)
    const h = r.repository?.defaultBranchRef?.target.history
    if (!h) throw new Error(`No history for ${fullName}`)
    for (const c of h.nodes) {
      const d = c.committedDate.slice(0, 10)
      counts.set(d, (counts.get(d) ?? 0) + 1)
    }
    if (!h.pageInfo.hasNextPage) break
    cursor = h.pageInfo.endCursor
  }
  const days: Day[] = []
  for (let t = start.getTime(); t < Date.parse(today + 'T00:00:00Z'); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10)
    days.push({ date: d, count: counts.get(d) ?? 0 })
  }
  return days
}

/** Several repositories summed per day. */
export async function collectRepos(names: string[], opts: { today?: string } = {}): Promise<Day[]> {
  const all = await Promise.all(names.map((n) => collectRepo(n, opts)))
  return all[0].map((d, i) => ({ date: d.date, count: all.reduce((s, days) => s + days[i].count, 0) }))
}

export async function collect(login: string, opts: { today?: string } = {}): Promise<Snapshot> {
  const tk = token()
  const today = opts.today ?? new Date().toISOString().slice(0, 10)

  type Cal = { user: { contributionsCollection: { contributionCalendar: { weeks: Array<{ contributionDays: Array<{ date: string; contributionCount: number }> }> } } } }
  const cal = await gql<Cal>(CALENDAR, { login }, tk)
  if (!cal.user) throw new Error(`No GitHub user "${login}"`)
  const days: Day[] = cal.user.contributionsCollection.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .filter((d) => d.date < today) // only complete days
    .map((d) => ({ date: d.date, count: d.contributionCount }))

  type Repos = { user: { repositories: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Array<{ languages: { edges: Array<{ size: number; node: { name: string; color: string | null } }> } }> } } }
  const size = new Map<string, number>()
  const color = new Map<string, string>()
  let cursor: string | null = null
  for (let page = 0; page < 10; page++) {
    const r: Repos = await gql<Repos>(REPOS, { login, cursor }, tk)
    for (const repo of r.user.repositories.nodes) {
      for (const e of repo.languages.edges) {
        size.set(e.node.name, (size.get(e.node.name) ?? 0) + e.size)
        if (e.node.color) color.set(e.node.name, e.node.color)
      }
    }
    if (!r.user.repositories.pageInfo.hasNextPage) break
    cursor = r.user.repositories.pageInfo.endCursor
  }
  const total = [...size.values()].reduce((s, v) => s + v, 0) || 1
  const languages: Language[] = [...size.entries()]
    .map(([name, v]) => ({ name, color: color.get(name) ?? '#8b949e', share: Math.round((v / total) * 1000) / 1000 }))
    .filter((l) => l.share >= 0.01)
    .sort((a, b) => b.share - a.share)

  return { login, collectedAt: new Date().toISOString(), days, languages }
}
