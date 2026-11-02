#!/usr/bin/env node
// lauv build [--config lauv.json] [--login name] [--out dir]
// lauv <login> [--out lauv.svg] [--detail film|cel] [--hud]
// lauv collect <login> [--out snapshot.json]
// lauv render <snapshot.json> [--out lauv.svg] [--yesterday N] [--detail film|cel] [--hud] [--static]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { collect, collectRepos } from './collect.ts'
import { render, renderCutting, type Detail, type Snapshot } from './render.ts'

export interface Config {
  login?: string
  /** Output directory. Default "lauv". */
  out?: string
  detail?: Detail
  hud?: boolean
  /** File name for the branch. Default "hero.svg". */
  hero?: string
  /** One portrait card per project, numbered in this order. */
  cuttings?: Array<{
    file: string
    name: string
    tagline?: string
    /** Repositories whose default-branch commits grow the sprig. */
    repos?: string[]
    /** "calendar" uses the account's whole contribution calendar instead of repositories. */
    source?: 'calendar'
  }>
}

const argv = process.argv.slice(2)
const flag = (name: string) => {
  const i = argv.indexOf(name)
  if (i < 0) return undefined
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}
const bool = (name: string) => {
  const i = argv.indexOf(name)
  if (i < 0) return false
  argv.splice(i, 1)
  return true
}

const write = (path: string, data: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
  console.log(`wrote ${path}`)
}

async function build(cfgPath: string, loginFlag?: string, outFlag?: string) {
  const cfg: Config = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {}
  const login = loginFlag || cfg.login || process.env.LAUV_LOGIN || process.env.GITHUB_REPOSITORY_OWNER
  if (!login) throw new Error('No account. Pass --login or set "login" in lauv.json.')
  const out = outFlag || cfg.out || process.env.LAUV_OUT || 'lauv'
  const detail = cfg.detail ?? 'film'

  const snap = await collect(login)
  write(join(out, cfg.hero ?? 'hero.svg'), render(snap, { detail, hud: cfg.hud }))

  for (const [i, c] of (cfg.cuttings ?? []).entries()) {
    try {
      const days = c.source === 'calendar' ? snap.days : await collectRepos(c.repos ?? [])
      write(join(out, c.file), renderCutting({ name: c.name, index: i + 1, tagline: c.tagline, days }, { detail }))
    } catch (e) {
      // A repository the token cannot read keeps its previous drawing.
      console.log(`::warning::${c.name}: ${e instanceof Error ? e.message : e}. Kept the previous ${c.file}.`)
    }
  }
}

async function main() {
  const out = flag('--out')
  const yesterday = flag('--yesterday')
  const detail = flag('--detail') as Detail | undefined
  const config = flag('--config')
  const login = flag('--login')
  const animate = !bool('--static')
  const hud = bool('--hud')
  const [cmd, arg] = argv
  const ropts = { animate, hud, detail, yesterday: yesterday === undefined ? undefined : Number(yesterday) }

  if (cmd === 'build') {
    await build(config ?? 'lauv.json', login, out)
  } else if (cmd === 'collect' && arg) {
    write(out ?? 'snapshot.json', JSON.stringify(await collect(arg), null, 2))
  } else if (cmd === 'render' && arg) {
    const snap = JSON.parse(readFileSync(arg, 'utf8')) as Snapshot
    write(out ?? 'lauv.svg', render(snap, ropts))
  } else if (cmd && cmd !== 'help' && !cmd.startsWith('-')) {
    write(out ?? 'lauv.svg', render(await collect(cmd), ropts))
  } else {
    console.log(`usage:
  lauv build [--config lauv.json] [--login name] [--out dir]
  lauv <login> [--out lauv.svg] [--detail film|cel] [--hud]
  lauv collect <login> [--out snapshot.json]
  lauv render <snapshot.json> [--out lauv.svg] [--yesterday N] [--detail film|cel] [--hud] [--static]`)
    process.exit(cmd ? 0 : 2)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
