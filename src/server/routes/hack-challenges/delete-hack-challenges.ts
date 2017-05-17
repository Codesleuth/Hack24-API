import { Request, IReply } from 'hapi'
import { HackModel } from '../../models'
import { HackChallengesRelationship } from '../../../resources'
import EventBroadcaster from '../../eventbroadcaster'
import * as Boom from 'boom'
import { Credentials } from '../../plugins/attendee-auth-strategy'

export default async function handler(req: Request, reply: IReply) {
  const { hackId: hackid } = req.params
  const requestDoc: HackChallengesRelationship.TopLevelDocument = req.payload
  const credentials: Credentials = req.auth.credentials

  const hacks = await HackModel
    .find({ hackid })
    .select('_id hackid name challenges team')
    .populate({
      path: 'challenges',
      select: 'challengeid name',
    })
    .populate({
      path: 'team',
      select: 'members',
      populate: {
        path: 'members',
        match: { _id: credentials.user._id },
        select: 'userid',
        options: { limit: 1 },
      },
    })
    .exec()

  if (hacks.length === 0) {
    reply(Boom.notFound('Hack not found'))
    return
  }

  const hack = hacks[0]

  if (hack.team.members.length < 1) {
    reply(Boom.forbidden('Only team members can add a challenge to a hack'))
    return
  }

  const challengesToDelete = hack.challenges.filter((challenge) => {
    return requestDoc.data.some((challengeToDelete) => challenge.challengeid === challengeToDelete.id)
  })

  if (challengesToDelete.length < requestDoc.data.length) {
    reply(Boom.badRequest())
    return
  }

  const challengeIdsToDelete = challengesToDelete.map((challenge) => challenge.challengeid)
  hack.challenges = hack.challenges.filter((challenge) => challengeIdsToDelete.indexOf(challenge.challengeid) === -1)

  await hack.save()

  const eventBroadcaster: EventBroadcaster = req.server.app.eventBroadcaster
  challengesToDelete.forEach((challenge) => {
    eventBroadcaster.trigger('hacks_update_challenges_delete', {
      hackid: hack.hackid,
      name: hack.name,
      entry: {
        challengeid: challenge.challengeid,
        name: challenge.name,
      },
    }, req.logger)
  })

  reply()
}
