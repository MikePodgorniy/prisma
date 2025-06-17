import { AsyncLocalStorage } from 'node:async_hooks'
import { MongoClient, Db, ClientSession } from 'mongodb'
import {
  type SqlDriverAdapter,
  type SqlDriverAdapterFactory,
  type SqlQueryable,
  type SqlQuery,
  type SqlResultSet,
  type Transaction,
  type TransactionOptions,
  type IsolationLevel,
  type ConnectionInfo,
} from '@prisma/driver-adapter-utils'
import { Debug, DriverAdapterError } from '@prisma/driver-adapter-utils'

import { name as packageName } from '../package.json'

const debug = Debug('prisma:driver-adapter:mongodb')

interface TransactionContext {
  db: Db
  session: ClientSession
}

const txStorage = new AsyncLocalStorage<TransactionContext>()

type StdClient = MongoClient

class MongoQueryable implements SqlQueryable {
  readonly provider = 'postgres' as SqlDriverAdapter['provider'] // placeholder
  readonly adapterName = packageName

  constructor(protected readonly db: Db) {}

  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const tag = '[js::query_raw]'
    debug('%s %o', tag, query)

    const cmd = typeof query.sql === 'string' ? JSON.parse(query.sql) : query.sql
    const session = txStorage.getStore()?.session

    const result = await this.db.command(cmd, { session })

    return {
      columnNames: [],
      columnTypes: [],
      rows: [result],
    }
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    const r = await this.queryRaw(query)
    return r.rows.length
  }
}

class MongoTransaction extends MongoQueryable implements Transaction {
  constructor(db: Db, private session: ClientSession, readonly options: TransactionOptions) {
    super(db)
  }

  async commit(): Promise<void> {
    debug('[js::commit]')
    await this.session.commitTransaction()
    this.session.endSession()
  }

  async rollback(): Promise<void> {
    debug('[js::rollback]')
    await this.session.abortTransaction()
    this.session.endSession()
  }
}

export type PrismaMongoOptions = {
  dbName: string
}

export class PrismaMongoAdapter extends MongoQueryable implements SqlDriverAdapter {
  constructor(private readonly client: StdClient, private readonly options: PrismaMongoOptions) {
    super(client.db(options.dbName))
  }

  executeScript(_script: string): Promise<void> {
    throw new Error('Not implemented yet')
  }

  async startTransaction(_isolationLevel?: IsolationLevel): Promise<Transaction> {
    const session = this.client.startSession()
    await session.startTransaction()
    const tx = new MongoTransaction(this.client.db(this.options.dbName), session, { usePhantomQuery: false })
    txStorage.enterWith({ db: this.client.db(this.options.dbName), session })
    return tx
  }

  getConnectionInfo(): ConnectionInfo {
    return { schemaName: this.options.dbName }
  }

  async dispose(): Promise<void> {
    await this.client.close()
  }
}

export class PrismaMongoAdapterFactory implements SqlDriverAdapterFactory {
  readonly provider = 'postgres' as SqlDriverAdapter['provider'] // placeholder
  readonly adapterName = packageName

  constructor(private readonly options: { url: string; dbName: string }) {}

  async connect(): Promise<SqlDriverAdapter> {
    const client = new MongoClient(this.options.url)
    try {
      await client.connect()
      return new PrismaMongoAdapter(client, { dbName: this.options.dbName })
    } catch (e) {
      throw new DriverAdapterError({ kind: 'GenericJs', id: 0 })
    }
  }
}
