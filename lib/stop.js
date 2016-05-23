const co = require('co')
const path = require('path')
const mkdirp = require('mkdirp-promise')
const execa = require('execa')
const fs = require('mz/fs')
const childProcess = require('mz/child_process')

const wait = require('./wait')

module.exports = co.wrap(function * ({ dataDirectory, timeout = 0, port = 5432 }) {
  mkdirp(dataDirectory)

  const psqlVOutput = yield execa.stdout('psql', ['-V'])
  const postgresVersion = psqlVOutput.replace(/.*([0-9]+\.[0-9]+)\.[0-9]+/, '$1')

  try {
    yield fs.access(path.join(dataDirectory, postgresVersion, 'postgresql.conf'), fs.R_OK | fs.W_OK)

    const env = Object.assign({}, process.env, { PGPORT: port, PGHOST: dataDirectory })

    let count = 2
    while (count >= 2) {
      yield wait(timeout * 1000)
      try {
        count = (yield childProcess.exec('psql test -At -c "SELECT count(*) FROM pg_stat_activity;"', { env }))[0]
      } catch (e) {
        count = 0
      }
    }

    yield execa('pg_ctl', [ '-D', path.join(dataDirectory, postgresVersion), 'stop' ])
    yield wait(1000)
  } catch (e) {
    console.error('Please specify a PostgreSQL data directory using -d')
    process.exitCode = 1
  }
})

process.on('message', function (message) {
  if (message.action === 'stop') {
    module.exports(message)
  }
})
