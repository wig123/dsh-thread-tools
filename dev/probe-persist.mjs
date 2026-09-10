import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
const dshInstall = '/Users/oneway/.npm-global/lib/node_modules/@deepseek-ai/dsh'
const home = '/Users/oneway/.dsh'
const profileName = 'probe-session-tools'
const boot = await import('@deepseek-ai/dsh-app-boot')
const profile = boot.loadProfile('probe', profileName, join(dshInstall, 'package.json'), home)
const patches = profile.layers.flatMap(l => l.patches)
const ctx = await boot.boot('probe', join(profile.dir, 'cordis.yml'), [...patches, profile.patches], undefined, pathToFileURL(`${profile.dir}/`).href)
const s = ctx.get('sessionPersistence')
console.log('service:', typeof s, s?.constructor?.name, 'name=', s?.name)
console.log('own list type:', typeof s?.list)
try {
  const r = await s.list()
  console.log('list ok, count =', r.length)
  console.log('first header:', JSON.stringify(r[0]).slice(0, 200))
} catch (e) {
  console.log('list failed:', e.message)
  console.log(e.stack?.split('\n').slice(0, 6).join('\n'))
}
console.log('--- probe complete, exiting without disposal drain ---')
process.exit(0)
