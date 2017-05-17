import { Db, Collection, ObjectID } from 'mongodb'
import { Random } from '../utils/random'

export interface Hack {
  _id?: ObjectID
  hackid: string
  name: string
  team: ObjectID
  challenges: ObjectID[]
}

export class Hacks {

  public static Create(db: Db): Promise<Hacks> {
    return new Promise<Hacks>((resolve, reject) => {
      const hacks = new Hacks()
      db.collection('hacks', (err, collection) => {
        if (err) {
          return reject(err)
        }
        hacks._collection = collection
        resolve(hacks)
      })
    })
  }

  private _collection: Collection

  public removeAll(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._collection.deleteMany({}).then(() => {
        resolve()
      }).catch((err) => {
        reject(new Error('Could not remove all hacks: ' + err.message))
      })
    })
  }

  public removeByName(name: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._collection.deleteOne({ name: name }).then(() => {
        resolve()
      }).catch((err) => {
        reject(new Error('Could not remove hack: ' + err.message))
      })
    })
  }

  public removeByHackId(hackid: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._collection.deleteOne({ hackid: hackid }).then(() => {
        resolve()
      }).catch((err) => {
        reject(new Error('Could not remove hack: ' + err.message))
      })
    })
  }

  public createRandomHack(options?: { prefix?: string, team?: ObjectID }): Hack {
    options = options || {}
    options.prefix = options.prefix || ''
    const randomPart = Random.str(5)
    return {
      hackid: `random-hack-${options.prefix}${randomPart}`,
      name: `Random Hack ${options.prefix}${randomPart}`,
      team: options.team,
      challenges: [],
    }
  }

  public insertHack(hack: Hack): Promise<ObjectID> {
    return new Promise<ObjectID>((resolve, reject) => {
      this._collection.insertOne(hack).then(() => {
        resolve()
      }).catch((err) => {
        reject(new Error('Could not insert hack: ' + err.message))
      })
    })
  }

  public insertRandomHack(options: { prefix?: string, team: ObjectID }): Promise<Hack> {
    if (!options.team) {
      throw new Error('Must provide a team when creating a hack')
    }

    const randomHack = this.createRandomHack(options)
    return new Promise<Hack>((resolve, reject) => {
      this._collection.insertOne(randomHack).then((result) => {
        randomHack._id = result.insertedId
        resolve(randomHack)
      }).catch((err) => {
        reject(new Error('Could not insert random hack: ' + err.message))
      })
    })
  }

  public findbyName(name: string): Promise<Hack> {
    return new Promise<Hack>((resolve, reject) => {
      this._collection.find({ name: name }).limit(1).toArray().then((hacks: Hack[]) => {
        resolve(hacks.length > 0 ? hacks[0] : null)
      }).catch((err) => {
        reject(new Error('Error when finding hack: ' + err.message))
      })
    })
  }

  public findByHackId(hackid: string): Promise<Hack> {
    return new Promise<Hack>((resolve, reject) => {
      this._collection.find({ hackid: hackid }).limit(1).toArray().then((hacks: Hack[]) => {
        resolve(hacks.length > 0 ? hacks[0] : null)
      }).catch((err) => {
        reject(new Error('Error when finding hack: ' + err.message))
      })
    })
  }
}
