const co = require('co')
const os = require('os')
const path = require('path')
const glob = require('glob-promise')
const execa = require('execa')
const fs = require('mz/fs')
const childProcess = require('mz/child_process')
const devNull = require('dev-null')

const wait = require('./wait')
const init = require('./init')

const { NEW_MARKER } = require('./constants')

module.exports = co.wrap(function * ({
  dataDirectory,
  timeout = 60,
  port = '',
  listenAddress = '127.0.0.1',
  userOptions,
  stdio: {
    stdout = devNull(),
    stderr = devNull()
  }
}) {
  const psqlVOutput = yield execa.stdout('psql', ['-V'])
  const postgresVersion = psqlVOutput.replace(/.*([0-9]+\.[0-9]+)\.[0-9]+/, '$1')

  if (!dataDirectory) {
    const tmpDirectories = (yield glob(`${os.tmpdir()}/pg-tmp-*/${postgresVersion}`)).map((dir) => path.dirname(dir))

    for (let tmpDirectory of tmpDirectories) {
      try {
        yield fs.stat(path.join(tmpDirectory, NEW_MARKER))
        dataDirectory = tmpDirectory
        break
      } catch (e) {
        continue
      }
    }

    if (!dataDirectory) {
      dataDirectory = this.init()
    }

    const child = childProcess.fork(path.join(__dirname, './init'))
    child.send({ action: 'init', dataDirectory })
    child.disconnect()
    child.unref()
  } else {
    try {
      yield fs.stat(dataDirectory)
    } catch (e) {
      dataDirectory = init(dataDirectory)
    }
  }

  const child = childProcess.fork(path.join(__dirname, './stop'))
  child.send({
    action: 'stop',
    dataDirectory,
    timeout,
    port
  })
  child.disconnect()
  child.unref()

  yield fs.unlink(path.join(dataDirectory, NEW_MARKER))

  const options = port ? `-c listen_addresses='${listenAddress}' -c port=${port}` : ''

  const logfile = path.join(dataDirectory, postgresVersion, 'postgres.log')

  yield execa.shell(`pg_ctl -o "${options} ${userOptions}" -s -D ${path.join(dataDirectory, postgresVersion)} -l ${logfile} start`)
  let env = process.env
  env.PGHOST = dataDirectory
  if (port) {
    env.PGPORT = port
  }

  const url = port ? `postgresql://${listenAddress}:${port}/test2` : `postgresql:///test2?host=${dataDirectory.replace(/\//g, '%2F')}`

  let dbCreated = false
  for (let i = 0; i < 5; i++) {
    yield wait(100)

    try {
      yield execa.stdout(
        'psql',
        [ '-c',
          'CREATE DATABASE test2 ENCODING UNICODE;',
          `postgresql:///postgres?host=${dataDirectory.replace(/\//g, '%2F')}`
        ])
      // yield childProcess.exec('createdb -E UNICODE test2', { env })
      dbCreated = true
      break
    } catch (e) {}
  }

  if (dbCreated) {
    stdout.write(url + (process.stdout.isTTY ? '\n' : ''))
  } else {
    const log = yield fs.readFile(logfile, 'utf8')
    stderr.write(log + '\n')
    throw new Error('Failed to create database')
  }

  return url
})
