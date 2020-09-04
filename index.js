const cp = require('child_process')
const fs = require('fs')
const path = require('path')
const semver = require('semver')

async function main() {
  const package = process.argv[2]
  const version = process.argv[3]

  if (!package || !version) {
    console.error(`Usage: node index.js <packageName> <versionToUse>`)
    process.exit(1)
  }

  const projects = [
    "/Users/mtilley/github/primer-components/docs",
    "/Users/mtilley/github/primer-css/docs",
    "/Users/mtilley/github/primer-design",
    "/Users/mtilley/github/primer-presentations",
    "/Users/mtilley/github/primer.style"
  ]

  for (const project of projects) {
    try {
      await updateProject(project, package, version)
    } catch (err) {
      console.error(` > FATAL error while updating project ${project}. Work tree may be in a dirty state.`)
      console.error(err)
    }
  }
}

async function updateProject(dir, package, version) {
  console.log(`Starting upgrade in ${dir}...`)

  const pf = (...parts) => path.join(dir, ...parts)
  const exec = (command) => {
    return new Promise((resolve, reject) => {
      const child = cp.exec(command, {cwd: dir}, (err, stdout, stderr) => {
        if (err) {
          return reject(stderr)
        } else {
          return resolve(stdout)
        }
      })
    })
  }

  console.log(' > Pulling changes...')
  const branch = (await exec('git rev-parse --symbolic-full-name --abbrev-ref HEAD')).trim()
  if (branch !== 'master') {
    const dirty = await exec('git diff --quiet || echo dirty')
    if (dirty.length) {
      console.error(` > Current branch is not master (${branch}) and work tree is dirty. Skipping.`)
      return
    }

    await exec('git checkout master')
  }
  const bumpBranch = `multibump/${package}-${version}-${new Date().getTime()}`
  await exec('git pull')
  await exec(`git checkout -b ${bumpBranch}`)

  console.log(' > Updating package.json...')
  const hasPjson = fs.existsSync(pf('package.json'))
  if (!hasPjson) {
    console.error(` > No package.json found. Skipping`)
    return
  }

  const isNpm = fs.existsSync(pf('package-lock.json'))
  const isYarn = fs.existsSync(pf('yarn.lock'))

  if ((isNpm && isYarn) || !(isNpm || isYarn)) {
    console.error(` > Could not determine whether project uses npm or yarn. Work tree may be in dirty state. Skipping.`)
    return
  }

  const data = fs.readFileSync(pf('package.json'), 'utf8')
  const json = JSON.parse(data)
  const depType = ['dependencies', 'devDependencies'].find(type => json[type] && json[type][package])
  if (!depType) {
    console.error(`Could not find ${package} in ${dir}/package.json. Skipping.`)
    return
  }

  let versionQualifier = ""
  let currentVersion = json[depType][package]
  if (!currentVersion[0].match(/\d+/)) {
    versionQualifier = currentVersion[0]
    currentVersion = currentVersion.substr(1)
  }

  if (semver.gte(currentVersion, version)) {
    console.error(`Current version ${currentVersion} already >= ${version} in ${dir}. Skipping.`)
    return
  }

  json[depType][package] = `${versionQualifier}${version}`
  fs.writeFileSync(pf('package.json'), JSON.stringify(json, null, '  '))

  console.log(' > Installing dependencies to generate lockfile...')
  if (isNpm) {
    await exec('npm i')
  } else if (isYarn) {
    await exec('yarn')
  }

  const files = isNpm ? 'package.json package-lock.json' : 'package.json yarn.lock'
  console.log(' > Pushing to GitHub...')
  await exec(`git add -u ${files}`)
  await exec(`git commit -m "Upgrading ${package} to ${version}"`)
  await exec(`git push -u origin ${bumpBranch}`)
  console.log(' > Creating pull request...')
  const body = `Auto-upgrade of \\\`${package}\\\` to \\\`${version}\\\` via multibump.`
  const title = `Auto-bump: ${package}@${version}`
  const pr = await exec(`gh pr create -B master -b "${body}" -t "${title}"`)
  console.log(` > PR URL: ${pr.trim()}`)
  console.log(` > Upgrade complete. Returning to branch ${branch}.`)
  console.log('')
  await exec(`git checkout ${branch}`)
}

main()
