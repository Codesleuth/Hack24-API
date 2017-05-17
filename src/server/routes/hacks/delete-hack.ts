import { Request, IReply } from 'hapi'
import { HackModel } from '../../models'
import * as Boom from 'boom'
import { Credentials } from '../../plugins/attendee-auth-strategy'

export default async function handler(req: Request, reply: IReply) {
  const { hackId: hackid } = req.params
  const credentials: Credentials = req.auth.credentials

  const hacks = await HackModel
    .find({ hackid })
    .select('_id team')
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
    reply(Boom.forbidden('Only team members can delete a hack'))
    return
  }

  await HackModel.remove({ _id: hack._id }).exec()

  reply()
}
