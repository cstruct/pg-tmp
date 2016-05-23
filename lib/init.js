const co = require('co')
const path = require('path')
const mkdirp = require('mkdirp-promise')
const execa = require('execa')
const fs = require('mz/fs')
const temp = require('fs-temp/promise').template('pg-tmp-%s')

const { NEW_MARKER } = require('./constants')

module.exports = co.wrap(function * (dataDirectory) {
  if (!dataDirectory) dataDirectory = yield temp.mkdir()
  else mkdirp(dataDirectory)

  const psqlVOutput = yield execa.stdout('psql', ['-V'])
  const postgresVersion = psqlVOutput.replace(/.*([0-9]+\.[0-9]+)\.[0-9]+/, '$1')

  const initDdResult = yield execa.stdout('initdb', [
    '--nosync',
    '-D',
    path.join(dataDirectory, postgresVersion),
    '-E',
    'UNICODE',
    '-A',
    'trust'
  ])

  yield fs.writeFile(path.join(dataDirectory, 'initdb.out'), initDdResult)

  yield fs.writeFile(path.join(dataDirectory, postgresVersion, 'postgresql.conf'), `
        unix_socket_directories = '${dataDirectory}'
	      listen_addresses = ''
	      shared_buffers = 12MB
	      fsync = off
	      synchronous_commit = off
	      full_page_writes = off
	      log_min_duration_statement = 0
	      log_connections = on
	      log_disconnections = on
      `)

  const newFile = path.join(dataDirectory, NEW_MARKER)
  yield fs.close(yield fs.open(newFile, 'a'))

  return dataDirectory
})

process.on('message', function (message) {
  if (message.action === 'init') {
    module.exports(message.dataDirectory)
  }
})
