import { Request, IReply } from 'hapi'
import { MongoDBErrors } from '../../models'
import { Hack, HackModel, TeamModel } from '../../models'
import { HackResource } from '../../../resources'
import EventBroadcaster from '../../eventbroadcaster'
import * as Boom from 'boom'
import { slugify } from '../../utils'
import { Credentials } from '../../plugins/attendee-auth-strategy'

export default async function handler(req: Request, reply: IReply) {
  const requestDoc: HackResource.TopLevelDocument = req.payload
  const credentials: Credentials = req.auth.credentials

  const teams = await TeamModel
    .find({ teamid: requestDoc.data.relationships.team.data.id })
    .select('_id teamid name motto members')
    .populate({
      path: 'members',
      match: { _id: credentials.user._id },
      select: '_id userid',
      options: { limit: 1 },
    })
    .limit(1)
    .exec()

  if (teams.length === 0) {
    reply(Boom.badRequest('Team does not exist'))
    return
  }

  const team = teams[0]

  if (team.members.length < 1) {
    reply(Boom.forbidden('Only team members can create a hack'))
    return
  }

  const hack = new HackModel({
    hackid: slugify(requestDoc.data.attributes.name),
    name: requestDoc.data.attributes.name,
    team,
  } as Hack)

  try {
    await hack.save()
  } catch (err) {
    if (err.code === MongoDBErrors.E11000_DUPLICATE_KEY) {
      reply(Boom.conflict('Hack already exists'))
      return
    }
    throw err
  }

  const hackResponse: HackResource.TopLevelDocument = {
    links: {
      self: `/hacks/${encodeURIComponent(hack.hackid)}`,
    },
    data: {
      type: 'hacks',
      id: hack.hackid,
      attributes: {
        name: hack.name,
      },
    },
  }

  const eventBroadcaster: EventBroadcaster = req.server.app.eventBroadcaster
  eventBroadcaster.trigger('hacks_add', {
    hackid: hack.hackid,
    name: hack.name,
    team: {
      teamid: team.teamid,
      name: team.name,
      motto: team.motto,
    },
  }, req.logger)

  reply(hackResponse).code(201)
}
