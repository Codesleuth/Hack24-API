import { Request } from 'hapi'
import { Logger } from 'pino'
import { WebClient, UsersInfoResponse, User as SlackUser } from '@slack/client'
import { PluginRegister } from '../../hapi.types'
import { User, UserModel, AttendeeModel, MongoDBErrors } from '../models'

type ValidateFuncCallback = (err: any, isValid?: boolean, credentials?: any) => void

interface PluginOptions {
  slack: WebClient,
  password: string,
}

export interface Credentials {
  attendee: {
    _id: any,
    attendeeid: string,
  }
  user: {
    _id: any,
    userid: string,
    name: string,
  }
}

async function getSlackApiUser(slackid: string, slackClient: WebClient) {
  let slackUser: UsersInfoResponse
  try {
    slackUser = await slackClient.users.info(slackid)
  } catch (err) {
    throw new Error(`Could not look-up user "${slackid}" on Slack API: ${err.message}`)
  }

  if (!slackUser.ok) {
    throw new Error(`Could not look-up user "${slackid}" on Slack API: the response was not OK`)
  }

  return slackUser.user
}

async function findOrCreateUser(slackid: string, slackUser: SlackUser, slackClient: WebClient, log: Logger) {
  const users = await UserModel
    .find({ userid: slackid })
    .select('_id userid name')
    .limit(1)
    .exec()

  let user = users.length > 0 ? users[0] : null

  if (user) {
    return user
  }

  if (!slackUser) {
    try {
      slackUser = await getSlackApiUser(slackid, slackClient)
    } catch (err) {
      log.warn(err)
      return null
    }
  }

  user = new UserModel({
    userid: slackUser.id,
    name: slackUser.name,
  } as User)

  try {
    await user.save()
  } catch (err) {
    // only possible in a race condition
    if (err.code !== MongoDBErrors.E11000_DUPLICATE_KEY) {
      throw new Error(`Unable to save user with userid "${user.userid}"`)
    }
  }

  return user
}

async function getAttendeeBySlackId(slackid: string) {
  const attendees = await AttendeeModel
    .find({ slackid: slackid })
    .select('_id attendeeid slackid')
    .limit(1)
    .exec()

  return attendees.length > 0 ? attendees[0] : null
}

async function getAttendeeByEmail(email: string) {
  const attendees = await AttendeeModel
    .find({ attendeeid: email })
    .select('_id attendeeid slackid')
    .limit(1)
    .exec()

  return attendees.length > 0 ? attendees[0] : null
}

async function validateAttendeeByEmailAddress(username: string, slackClient: WebClient, log: Logger): Promise<Credentials> {
  log.info(`Finding attendee with email "${username}"...`)
  const attendee = await getAttendeeByEmail(username)

  if (!attendee) {
    return null
  }

  const user = await findOrCreateUser(attendee.slackid, null, slackClient, log)

  if (!user) {
    return null
  }

  return {
    attendee: {
      _id: attendee._id,
      attendeeid: attendee.attendeeid,
    },
    user: {
      _id: user._id,
      userid: user.userid,
      name: user.name,
    },
  }
}

const slackIdPattern = /U[A-Z0-9]{8}/

async function validateAttendeeBySlackId(username: string, slackClient: WebClient, log: Logger): Promise<Credentials> {
  if (!slackIdPattern.test(username)) {
    log.info(`Invalid slackid: "${username}"`)
    return null
  }

  log.info(`Finding attendee with slackid "${username}"...`)
  let attendee = await getAttendeeBySlackId(username)

  let slackUser: SlackUser

  if (!attendee) {
    log.info(`Looking up Slack API user for "${username}"...`)

    try {
      slackUser = await getSlackApiUser(username, slackClient)
    } catch (err) {
      log.warn(err.message)
      return null
    }

    log.info(`Found slackid "${username}" in Slack API with email "${slackUser.profile.email}"`)
    attendee = await getAttendeeByEmail(slackUser.profile.email)

    if (!attendee) {
      log.warn(`Attendee could not be found with email "${slackUser.profile.email}"`)
      return null
    }

    log.info(`Found attendee for slackid "${username}" to be "${attendee.attendeeid}"`)
  }

  const user = await findOrCreateUser(username, slackUser, slackClient, log)

  if (!user) {
    return null
  }

  return {
    attendee: {
      _id: attendee._id,
      attendeeid: attendee.attendeeid,
    },
    user: {
      _id: user._id,
      userid: user.userid,
      name: user.name,
    },
  }
}

function validateAttendeeUser(username: string, slackClient: WebClient, log: Logger) {
  if (username.indexOf('@') > 0) {
    return validateAttendeeByEmailAddress(username, slackClient, log)
  }
  return validateAttendeeBySlackId(username, slackClient, log)
}

const register: PluginRegister = (server, options: PluginOptions, next) => {
  server.auth.strategy('attendee', 'basic', {
    realm: 'Attendee access',
    validateFunc: (request: Request, username: string, password: string, callback: ValidateFuncCallback) => {
      if (password !== options.password) {
        return callback(null, false)
      }
      validateAttendeeUser(username, options.slack, request.logger)
        .then((credentials) => callback(null, !!credentials, credentials || undefined))
        .catch((err) => callback(err))
    },
  })

  next()
}

register.attributes = {
  name: 'attendee-auth-strategy',
  version: '0.0.0',
}

export default register
