const co = require('co')
const path = require('path')
const assert = require('assert')
const fs = require('mz/fs')
const execa = require('execa')
const temp = require('fs-temp/promise').template('pg-tmp-%s')

const wait = require('./wait')

const init = require('./init')
const start = require('./start')

const rmR = co.wrap(function * (target) {
  for (const file of yield fs.readdirSync(target)) {
    var curPath = path.join(target, file)
    if ((yield fs.lstat(curPath)).isDirectory()) yield rmR(curPath)
    else yield fs.unlink(curPath)
  }
  yield fs.rmdir(target)
})

module.exports = co.wrap(function * () {
  const dataDirectory = yield temp.mkdir()
  try {
    process.stdout.write('Running: ')

    process.stdout.write('initdb ')
    const dir = yield init(dataDirectory)

    process.stdout.write('start ')
    const url = yield start({
      dataDirectory,
      timeout: 3,
      userOptions: '-c log_temp_files=100',
      stdio: {
        stderr: process.stderr
      }
    })

    process.stdout.write('psql ')
    assert.equal(yield execa.stdout('psql', [ '-At', '-c', 'select 5', url ]), 5)

    process.stdout.write('stop ')
    yield wait(10000)

    process.stdout.write('verify ')
    try {
      yield fs.stat(dir)
    } finally {}

    console.log('\nOK')
  } catch (e) {
    console.log(e.stack)
    process.exitCode = 1
  } finally {
    yield rmR(dataDirectory)
  }
})
