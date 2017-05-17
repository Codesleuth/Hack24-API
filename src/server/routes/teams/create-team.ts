import { Request, IReply } from 'hapi'
import * as Boom from 'boom'
import { Team, UserModel, TeamModel, MongoDBErrors } from '../../models'
import { TeamResource } from '../../../resources'
import EventBroadcaster from '../../eventbroadcaster'
import { slugify } from '../../utils'
import { Credentials } from '../../plugins/attendee-auth-strategy'
import { userModelToResourceObject, teamModelToResourceObject } from '../../responses'

export default async function handler(req: Request, reply: IReply) {
  const requestDoc: TeamResource.TopLevelDocument = req.payload
  const credentials: Credentials = req.auth.credentials

  const relationships = requestDoc.data.relationships
  const memberIds: string[] = []

  if (relationships && relationships.members && relationships.members.data) {
    memberIds.push(...relationships.members.data.map((member) => member.id))
  }

  if (memberIds.indexOf(credentials.user.userid) === -1) {
    memberIds.push(credentials.user.userid)
  }

  const team = new TeamModel({
    teamid: slugify(requestDoc.data.attributes.name),
    name: requestDoc.data.attributes.name,
    motto: requestDoc.data.attributes.motto || null,
    members: [],
  } as Team)

  let users: UserModel[] = []

  if (memberIds.length > 0) {
    users = await UserModel
      .find({ userid: { $in: memberIds } })
      .select('_id userid name')
      .exec()
    team.members = users.map((user) => user._id)
  }

  try {
    await team.save()
  } catch (err) {
    if (err.code === MongoDBErrors.E11000_DUPLICATE_KEY) {
      reply(Boom.conflict('Team already exists'))
      return
    }
    throw err
  }

  const teamResponse: TeamResource.TopLevelDocument = {
    data: teamModelToResourceObject(team),
    included: users.map(userModelToResourceObject),
  }

  const eventBroadcaster: EventBroadcaster = req.server.app.eventBroadcaster
  eventBroadcaster.trigger('teams_add', {
    teamid: team.teamid,
    name: team.name,
    motto: team.motto,
    members: users.map((user) => ({ userid: user.userid, name: user.name })),
  }, req.logger)

  reply(teamResponse).code(201)
}
