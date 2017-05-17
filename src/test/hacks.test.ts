import * as assert from 'assert'
import { MongoDB } from './utils/mongodb'
import { Team } from './models/teams'
import { Hack } from './models/hacks'
import { Attendee } from './models/attendees'
import { User } from './models/users'
import { ApiServer } from './utils/apiserver'
import * as request from 'supertest'
import { JSONApi, HacksResource, HackResource, TeamResource, UserResource } from '../resources'
import { PusherListener } from './utils/pusherlistener'
import { SlackApi } from './utils/slackapi'
import { Random } from './utils/random'

describe('Hacks resource', () => {

  let api: request.SuperTest<request.Test>

  before(() => {
    api = request(`http://localhost:${ApiServer.Port}`)
  })

  describe('POST new hack', () => {

    let team: Team
    let attendee: Attendee
    let user: User
    let hack: Hack
    let createdHack: Hack
    let statusCode: number
    let contentType: string
    let response: HackResource.TopLevelDocument
    let pusherListener: PusherListener

    before(async () => {
      ({ attendee, user } = await MongoDB.createAttendeeAndUser())
      team = await MongoDB.Teams.insertRandomTeam([user._id])
      hack = MongoDB.Hacks.createRandomHack()

      const hackRequest: HackResource.TopLevelDocument = {
        data: {
          type: 'hacks',
          attributes: {
            name: hack.name,
          },
          relationships: {
            team: {
              data: { type: 'teams', id: team.teamid },
            },
          },
        },
      }

      pusherListener = await PusherListener.Create(ApiServer.PusherPort)

      const res = await api.post('/hacks')
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(hackRequest)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      response = res.body

      createdHack = await MongoDB.Hacks.findByHackId(hack.hackid)
      await pusherListener.waitForEvent()
    })

    it('should respond with status code 201 Created', () => {
      assert.strictEqual(statusCode, 201)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should return the hack resource object self link', () => {
      assert.strictEqual(response.links.self, `/hacks/${hack.hackid}`)
    })

    it('should return the hack type', () => {
      assert.strictEqual(response.data.type, 'hacks')
    })

    it('should return the hack id', () => {
      assert.strictEqual(response.data.id, hack.hackid)
    })

    it('should return the hack name', () => {
      assert.strictEqual(response.data.attributes.name, hack.name)
    })

    it('should create the hack', () => {
      assert.ok(createdHack, 'Hack not found')
      assert.strictEqual(createdHack.hackid, hack.hackid)
      assert.strictEqual(createdHack.name, hack.name)
      assert.ok(createdHack.team.equals(team._id), 'Created hack team ID does not match')
    })

    it('should send a hacks_add event to Pusher', () => {
      assert.strictEqual(pusherListener.events.length, 1)

      const event = pusherListener.getEvent((ev) => ev.data.hackid === hack.hackid)
      assert.strictEqual(event.appId, ApiServer.PusherAppId)
      assert.strictEqual(event.contentType, 'application/json')
      assert.strictEqual(event.payload.channels[0], 'api_events')
      assert.strictEqual(event.payload.name, 'hacks_add')

      const data = JSON.parse(event.payload.data)
      assert.strictEqual(data.name, hack.name)
      assert.strictEqual(data.team.teamid, team.teamid)
      assert.strictEqual(data.team.name, team.name)
      assert.strictEqual(data.team.motto, team.motto)
    })

    after(() => Promise.all([
      MongoDB.Hacks.removeByHackId(hack.hackid),
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Users.removeByUserId(user.userid),
      MongoDB.Teams.removeByTeamId(team.teamid),

      pusherListener.close(),
    ]))

  })

  describe('POST new hack when not a team member', () => {

    let team: Team
    let attendee: Attendee
    let user: User
    let hack: Hack
    let statusCode: number
    let contentType: string
    let response: HackResource.TopLevelDocument

    before(async () => {
      ({ attendee, user } = await MongoDB.createAttendeeAndUser())
      team = await MongoDB.Teams.insertRandomTeam()
      hack = MongoDB.Hacks.createRandomHack()

      const hackRequest: HackResource.TopLevelDocument = {
        data: {
          type: 'hacks',
          attributes: {
            name: hack.name,
          },
          relationships: {
            team: {
              data: { type: 'teams', id: team.teamid },
            },
          },
        },
      }

      const res = await api.post('/hacks')
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(hackRequest)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      response = res.body
    })

    it('should respond with status code 403 Forbidden', () => {
      assert.strictEqual(statusCode, 403)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should return an error with status code 403 and the expected title', () => {
      assert.strictEqual(response.errors.length, 1)
      assert.strictEqual(response.errors[0].status, '403')
      assert.strictEqual(response.errors[0].title, 'Forbidden')
      assert.strictEqual(response.errors[0].detail, 'Only team members can create a hack')
    })

    after(() => Promise.all([
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Users.removeByUserId(user.userid),
      MongoDB.Teams.removeByTeamId(team.teamid),
    ]))

  })

  describe('POST hack which already exists', () => {

    let attendee: Attendee
    let user: User
    let hack: Hack
    let team: Team
    let statusCode: number
    let contentType: string
    let response: JSONApi.TopLevelDocument

    before(async () => {
      ({ attendee, user } = await MongoDB.createAttendeeAndUser())
      team = await MongoDB.Teams.insertRandomTeam([user._id])
      hack = await MongoDB.Hacks.insertRandomHack({ team: team._id })

      const hackRequest: HackResource.TopLevelDocument = {
        data: {
          type: 'hacks',
          attributes: {
            name: hack.name,
          },
          relationships: {
            team: {
              data: { type: 'teams', id: team.teamid },
            },
          },
        },
      }

      const res = await api.post('/hacks')
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(hackRequest)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      response = res.body
    })

    it('should respond with status code 409 Conflict', () => {
      assert.strictEqual(statusCode, 409)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should return an error with status code 409 and the expected title', () => {
      assert.strictEqual(response.errors.length, 1)
      assert.strictEqual(response.errors[0].status, '409')
      assert.strictEqual(response.errors[0].title, 'Conflict')
      assert.strictEqual(response.errors[0].detail, 'Hack already exists')
    })

    after(() => Promise.all([
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Users.removeByUserId(user.userid),
      MongoDB.Hacks.removeByHackId(hack.hackid),
    ]))

  })

  describe('POST hack with incorrect authentication', () => {

    let statusCode: number
    let contentType: string
    let authenticateHeader: string
    let response: JSONApi.TopLevelDocument
    let slackApi: SlackApi

    before(async () => {
      slackApi = await SlackApi.Create(ApiServer.SlackApiPort, ApiServer.SlackApiBasePath)
      slackApi.UsersList = {
        ok: false,
        error: 'user_not_found',
      }

      const res = await api.post('/hacks')
        .auth('U12345678', ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send({})
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      authenticateHeader = res.header['www-authenticate']
      response = res.body
    })

    it('should respond with status code 401 Unauthorised', () => {
      assert.strictEqual(statusCode, 401)
    })

    it('should respond with WWW-Authenticate header for basic realm "Attendee access"', () => {
      assert.strictEqual(authenticateHeader, 'Basic realm="Attendee access", error="Bad username or password"')
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should respond with the expected "Unauthorized" error', () => {
      assert.strictEqual(response.errors.length, 1)
      assert.strictEqual(response.errors[0].status, '401')
      assert.strictEqual(response.errors[0].title, 'Unauthorized')
      assert.strictEqual(response.errors[0].detail, 'Bad username or password')
    })

    after(() => slackApi.close())
  })

  describe('OPTIONS hacks', () => {

    let origin: string
    let statusCode: number
    let contentType: string
    let accessControlAllowOrigin: string
    let accessControlAllowMethods: string
    let accessControlAllowHeaders: string
    let accessControlExposeHeaders: string
    let accessControlMaxAge: string
    let response: string

    before(async () => {
      origin = Random.str()

      const res = await api.options('/hacks')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'GET')
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      accessControlAllowOrigin = res.header['access-control-allow-origin']
      accessControlAllowMethods = res.header['access-control-allow-methods']
      accessControlAllowHeaders = res.header['access-control-allow-headers']
      accessControlExposeHeaders = res.header['access-control-expose-headers']
      accessControlMaxAge = res.header['access-control-max-age']
      response = res.text
    })

    it('should respond with status code 204 No Content', () => {
      assert.strictEqual(statusCode, 204)
    })

    it('should return no content type', () => {
      assert.strictEqual(contentType, undefined)
    })

    it('should allow the origin access to the resource with GET', () => {
      assert.strictEqual(accessControlAllowOrigin, origin)
      assert.strictEqual(accessControlAllowMethods, 'GET')
      assert.deepEqual(accessControlAllowHeaders.split(','), ['Accept', 'Authorization', 'Content-Type', 'If-None-Match'])
      assert.deepEqual(accessControlExposeHeaders.split(','), ['WWW-Authenticate', 'Server-Authorization'])
      assert.strictEqual(accessControlMaxAge, '86400')
    })

    it('should return no body', () => {
      assert.strictEqual(response, '')
    })

  })

  describe('GET hacks', () => {

    let origin: string
    let firstUser: User
    let secondUser: User
    let firstTeam: Team
    let secondTeam: Team
    let firstHack: Hack
    let secondHack: Hack
    let statusCode: number
    let contentType: string
    let accessControlAllowOrigin: string
    let accessControlExposeHeaders: string
    let response: HacksResource.TopLevelDocument

    before(async () => {
      await MongoDB.Hacks.removeAll()

      origin = Random.str()

      firstUser = await MongoDB.Users.insertRandomUser()
      secondUser = await MongoDB.Users.insertRandomUser()

      firstTeam = await MongoDB.Teams.insertRandomTeam([firstUser._id])
      secondTeam = await MongoDB.Teams.insertRandomTeam([secondUser._id])

      firstHack = await MongoDB.Hacks.insertRandomHack({ prefix: 'A', team: firstTeam._id })
      secondHack = await MongoDB.Hacks.insertRandomHack({ prefix: 'B', team: secondTeam._id })

      const res = await api.get('/hacks')
        .set('Origin', origin)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      accessControlAllowOrigin = res.header['access-control-allow-origin']
      accessControlExposeHeaders = res.header['access-control-expose-headers']
      response = res.body
    })

    it('should respond with status code 200 OK', () => {
      assert.strictEqual(statusCode, 200)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should allow the origin access to the resource with GET', () => {
      assert.strictEqual(accessControlAllowOrigin, origin)
      assert.deepEqual(accessControlExposeHeaders.split(','), ['WWW-Authenticate', 'Server-Authorization'])
    })

    it('should return the hacks resource object self link', () => {
      assert.strictEqual(response.links.self, '/hacks')
    })

    it('should return the first hack', () => {
      const hackResponse = response.data[0]

      assert.strictEqual(hackResponse.type, 'hacks')
      assert.strictEqual(hackResponse.id, firstHack.hackid)
      assert.strictEqual(hackResponse.attributes.name, firstHack.name)

      assert.strictEqual(hackResponse.relationships.team.data.id, firstTeam.teamid)
      assert.strictEqual(hackResponse.relationships.team.data.type, 'teams')
    })

    it('should return the second hack', () => {
      const hackResponse = response.data[1]

      assert.strictEqual(hackResponse.type, 'hacks')
      assert.strictEqual(hackResponse.id, secondHack.hackid)
      assert.strictEqual(hackResponse.attributes.name, secondHack.name)

      assert.strictEqual(hackResponse.relationships.team.data.id, secondTeam.teamid)
      assert.strictEqual(hackResponse.relationships.team.data.type, 'teams')
    })

    it('should include each team and their members', () => {
      assert.strictEqual(response.included.length, 4)

      const firstIncludedTeam = response.included.find((o) => o.type === 'teams' && o.id === firstTeam.teamid) as TeamResource.ResourceObject
      const secondIncludedTeam = response.included.find((o) => o.type === 'teams' && o.id === secondTeam.teamid) as TeamResource.ResourceObject
      const firstIncludedUser = response.included.find((o) => o.type === 'users' && o.id === firstUser.userid) as UserResource.ResourceObject
      const secondIncludedUser = response.included.find((o) => o.type === 'users' && o.id === secondUser.userid) as UserResource.ResourceObject

      assert.strictEqual(firstIncludedTeam.links.self, `/teams/${firstTeam.teamid}`)
      assert.strictEqual(firstIncludedTeam.id, firstTeam.teamid)
      assert.strictEqual(firstIncludedTeam.type, 'teams')
      assert.strictEqual(firstIncludedTeam.attributes.name, firstTeam.name)
      assert.strictEqual(firstIncludedTeam.attributes.motto, firstTeam.motto)
      assert.strictEqual(firstIncludedTeam.relationships.members.data.length, 1)
      assert.strictEqual(firstIncludedTeam.relationships.members.data[0].id, firstUser.userid)
      assert.strictEqual(firstIncludedTeam.relationships.members.data[0].type, 'users')

      assert.strictEqual(secondIncludedTeam.links.self, `/teams/${secondTeam.teamid}`)
      assert.strictEqual(secondIncludedTeam.id, secondTeam.teamid)
      assert.strictEqual(secondIncludedTeam.type, 'teams')
      assert.strictEqual(secondIncludedTeam.attributes.name, secondTeam.name)
      assert.strictEqual(secondIncludedTeam.attributes.motto, secondTeam.motto)
      assert.strictEqual(secondIncludedTeam.relationships.members.data.length, 1)
      assert.strictEqual(secondIncludedTeam.relationships.members.data[0].id, secondUser.userid)
      assert.strictEqual(secondIncludedTeam.relationships.members.data[0].type, 'users')

      assert.strictEqual(firstIncludedUser.links.self, `/users/${firstUser.userid}`)
      assert.strictEqual(firstIncludedUser.id, firstUser.userid)
      assert.strictEqual(firstIncludedUser.type, 'users')
      assert.strictEqual(firstIncludedUser.attributes.name, firstUser.name)

      assert.strictEqual(secondIncludedUser.links.self, `/users/${secondUser.userid}`)
      assert.strictEqual(secondIncludedUser.id, secondUser.userid)
      assert.strictEqual(secondIncludedUser.type, 'users')
      assert.strictEqual(secondIncludedUser.attributes.name, secondUser.name)
    })

    after(() => Promise.all([
      MongoDB.Users.removeByUserId(firstUser.userid),
      MongoDB.Users.removeByUserId(secondUser.userid),
      MongoDB.Teams.removeByTeamId(firstTeam.teamid),
      MongoDB.Teams.removeByTeamId(secondTeam.teamid),
      MongoDB.Hacks.removeByHackId(firstHack.hackid),
      MongoDB.Hacks.removeByHackId(secondHack.hackid),
    ]))

  })

  describe('OPTIONS hacks by slug (hackid)', () => {

    let origin: string
    let statusCode: number
    let contentType: string
    let accessControlAllowOrigin: string
    let accessControlAllowMethods: string
    let accessControlAllowHeaders: string
    let accessControlExposeHeaders: string
    let accessControlMaxAge: string
    let response: string

    before(async () => {
      origin = Random.str()

      const hack = MongoDB.Hacks.createRandomHack()

      const res = await api.options(`/hacks/${hack.hackid}`)
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'GET')
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      accessControlAllowOrigin = res.header['access-control-allow-origin']
      accessControlAllowMethods = res.header['access-control-allow-methods']
      accessControlAllowHeaders = res.header['access-control-allow-headers']
      accessControlExposeHeaders = res.header['access-control-expose-headers']
      accessControlMaxAge = res.header['access-control-max-age']
      response = res.text
    })

    it('should respond with status code 204 No Content', () => {
      assert.strictEqual(statusCode, 204)
    })

    it('should return no content type', () => {
      assert.strictEqual(contentType, undefined)
    })

    it('should allow the origin access to the resource with GET', () => {
      assert.strictEqual(accessControlAllowOrigin, origin)
      assert.strictEqual(accessControlAllowMethods, 'GET')
      assert.deepEqual(accessControlAllowHeaders.split(','), ['Accept', 'Authorization', 'Content-Type', 'If-None-Match'])
      assert.deepEqual(accessControlExposeHeaders.split(','), ['WWW-Authenticate', 'Server-Authorization'])
      assert.strictEqual(accessControlMaxAge, '86400')
    })

    it('should return no body', () => {
      assert.strictEqual(response, '')
    })

  })

  describe('GET hack by slug (hackid)', () => {

    let origin: string
    let team: Team
    let hack: Hack
    let statusCode: number
    let contentType: string
    let accessControlAllowOrigin: string
    let accessControlExposeHeaders: string
    let response: HackResource.TopLevelDocument

    before(async () => {
      origin = Random.str()

      team = await MongoDB.Teams.insertRandomTeam()
      hack = await MongoDB.Hacks.insertRandomHack({ team: team._id })

      const res = await api.get(`/hacks/${hack.hackid}`)
        .set('Origin', origin)
        .set('Accept', 'application/json')
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      accessControlAllowOrigin = res.header['access-control-allow-origin']
      accessControlExposeHeaders = res.header['access-control-expose-headers']
      response = res.body
    })

    it('should respond with status code 200 OK', () => {
      assert.strictEqual(statusCode, 200)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should allow the origin access to the resource with GET', () => {
      assert.strictEqual(accessControlAllowOrigin, origin)
      assert.deepEqual(accessControlExposeHeaders.split(','), ['WWW-Authenticate', 'Server-Authorization'])
    })

    it('should return the hack resource object self link', () => {
      assert.strictEqual(response.links.self, `/hacks/${hack.hackid}`)
    })

    it('should return the hack primary data', () => {
      assert.strictEqual(response.data.type, 'hacks')
      assert.strictEqual(response.data.id, hack.hackid)
      assert.strictEqual(response.data.attributes.name, hack.name)
    })

    after(() => Promise.all([
      MongoDB.Hacks.removeByHackId(hack.hackid),
      MongoDB.Teams.removeByTeamId(team.teamid),
    ]))

  })

  describe('GET hack by slug (hackid) which does not exist', () => {

    let origin: string
    let statusCode: number
    let contentType: string
    let accessControlAllowOrigin: string
    let accessControlExposeHeaders: string
    let response: HackResource.TopLevelDocument

    before(async () => {
      origin = Random.str()

      const res = await api.get(`/hacks/does not exist`)
        .set('Origin', origin)
        .set('Accept', 'application/json')
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      accessControlAllowOrigin = res.header['access-control-allow-origin']
      accessControlExposeHeaders = res.header['access-control-expose-headers']
      response = res.body
    })

    it('should respond with status code 404 Not Found', () => {
      assert.strictEqual(statusCode, 404)
    })

    it('should allow the origin access to the resource with GET', () => {
      assert.strictEqual(accessControlAllowOrigin, origin)
      assert.deepEqual(accessControlExposeHeaders.split(','), ['WWW-Authenticate', 'Server-Authorization'])
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should respond with the expected "Resource not found" error', () => {
      assert.strictEqual(response.errors.length, 1)
      assert.strictEqual(response.errors[0].status, '404')
      assert.strictEqual(response.errors[0].title, 'Not Found')
      assert.strictEqual(response.errors[0].detail, 'Hack not found')
    })
  })

  describe('GET hacks by filter', () => {

    let origin: string
    let team: Team
    let firstHack: Hack
    let secondHack: Hack
    let thirdHack: Hack
    let statusCode: number
    let contentType: string
    let accessControlAllowOrigin: string
    let accessControlExposeHeaders: string
    let response: HacksResource.TopLevelDocument

    before(async () => {
      await MongoDB.Hacks.removeAll()

      origin = Random.str()

      team = await MongoDB.Teams.insertRandomTeam()

      firstHack = await MongoDB.Hacks.insertRandomHack({ prefix: 'ABCD', team: team._id })
      secondHack = await MongoDB.Hacks.insertRandomHack({ prefix: 'ABEF', team: team._id })
      thirdHack = await MongoDB.Hacks.insertRandomHack({ prefix: 'ABCE', team: team._id })

      const res = await api.get('/hacks?filter[name]=ABC')
        .set('Origin', origin)
        .set('Accept', 'application/json')
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      accessControlAllowOrigin = res.header['access-control-allow-origin']
      accessControlExposeHeaders = res.header['access-control-expose-headers']
      response = res.body
    })

    it('should respond with status code 200 OK', () => {
      assert.strictEqual(statusCode, 200)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should allow the origin access to the resource with GET', () => {
      assert.strictEqual(accessControlAllowOrigin, origin)
      assert.deepEqual(accessControlExposeHeaders.split(','), ['WWW-Authenticate', 'Server-Authorization'])
    })

    it('should return the hacks resource object self link', () => {
      assert.strictEqual(response.links.self, '/hacks')
    })

    it('should return two hacks', () => {
      assert.strictEqual(response.data.length, 2)
    })

    it('should return the first hack', () => {
      const hackResponse = response.data[0]

      assert.strictEqual(hackResponse.type, 'hacks')
      assert.strictEqual(hackResponse.id, firstHack.hackid)
      assert.strictEqual(hackResponse.attributes.name, firstHack.name)
    })

    it('should return the third hack', () => {
      const hackResponse = response.data[1]

      assert.strictEqual(hackResponse.type, 'hacks')
      assert.strictEqual(hackResponse.id, thirdHack.hackid)
      assert.strictEqual(hackResponse.attributes.name, thirdHack.name)
    })

    it('should include the team', () => {
      assert.strictEqual(response.included.length, 1)

      const includedTeam = response.included.find((o) => o.type === 'teams' && o.id === team.teamid) as TeamResource.ResourceObject

      assert.strictEqual(includedTeam.links.self, `/teams/${team.teamid}`)
      assert.strictEqual(includedTeam.id, team.teamid)
      assert.strictEqual(includedTeam.type, 'teams')
      assert.strictEqual(includedTeam.attributes.name, team.name)
      assert.strictEqual(includedTeam.attributes.motto, team.motto)
      assert.strictEqual(includedTeam.relationships.members.data.length, 0)
    })

    after(() => Promise.all([
      MongoDB.Hacks.removeByHackId(firstHack.hackid),
      MongoDB.Hacks.removeByHackId(secondHack.hackid),
      MongoDB.Hacks.removeByHackId(thirdHack.hackid),
    ]))

  })

  describe('DELETE hack', () => {

    let attendee: Attendee
    let user: User
    let team: Team
    let hack: Hack
    let deletedHack: Hack
    let statusCode: number
    let contentType: string
    let body: string

    before(async () => {
      ({ attendee, user } = await MongoDB.createAttendeeAndUser())
      team = await MongoDB.Teams.insertRandomTeam([user._id])
      hack = await MongoDB.Hacks.insertRandomHack({ team: team._id })

      const res = await api.delete(`/hacks/${encodeURIComponent(hack.hackid)}`)
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      body = res.text

      deletedHack = await MongoDB.Hacks.findByHackId(hack.hackid)
    })

    it('should respond with status code 204 No Content', () => {
      assert.strictEqual(statusCode, 204)
    })

    it('should return no content-type', () => {
      assert.strictEqual(contentType, undefined)
    })

    it('should return no body', () => {
      assert.strictEqual(body, '')
    })

    it('should have deleted the hack', () => {
      assert.strictEqual(deletedHack, null)
    })

    after(() => Promise.all([
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Users.removeByUserId(user.userid),
      MongoDB.Teams.removeByTeamId(team.teamid),
      MongoDB.Hacks.removeByHackId(hack.hackid),
    ]))

  })

  describe('DELETE hack when not a member of the team', () => {

    let attendee: Attendee
    let user: User
    let hack: Hack
    let team: Team
    let deletedHack: Hack
    let statusCode: number
    let contentType: string
    let response: JSONApi.TopLevelDocument

    before(async () => {
      ({ attendee, user } = await MongoDB.createAttendeeAndUser())
      team = await MongoDB.Teams.insertRandomTeam()
      hack = await MongoDB.Hacks.insertRandomHack({ team: team._id })

      const res = await api.delete(`/hacks/${encodeURIComponent(hack.hackid)}`)
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      response = res.body

      deletedHack = await MongoDB.Hacks.findByHackId(hack.hackid)
    })

    it('should respond with status code 403 Forbidden', () => {
      assert.strictEqual(statusCode, 403)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should respond with the expected "Only team members can delete a hack" error', () => {
      assert.strictEqual(response.errors.length, 1)
      assert.strictEqual(response.errors[0].status, '403')
      assert.strictEqual(response.errors[0].title, 'Forbidden')
      assert.strictEqual(response.errors[0].detail, 'Only team members can delete a hack')
    })

    it('should not delete the hack', () => {
      assert.strictEqual(deletedHack.hackid, hack.hackid)
    })

    after(() => Promise.all([
      MongoDB.Hacks.removeByHackId(hack.hackid),
      MongoDB.Teams.removeByTeamId(team.teamid),
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
    ]))

  })

  describe('DELETE hack which does not exist', () => {

    let attendee: Attendee
    let statusCode: number
    let contentType: string
    let response: JSONApi.TopLevelDocument

    before(async () => {
      attendee = await MongoDB.Attendees.insertRandomAttendee()

      const res = await api.delete(`/hacks/rwrerwygdfgd`)
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      response = res.body
    })

    it('should respond with status code 404 Not Found', () => {
      assert.strictEqual(statusCode, 404)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should respond with the expected "Hack not found" error', () => {
      assert.strictEqual(response.errors.length, 1)
      assert.strictEqual(response.errors[0].status, '404')
      assert.strictEqual(response.errors[0].title, 'Not Found')
      assert.strictEqual(response.errors[0].detail, 'Hack not found')
    })

    after(() => MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid))

  })

  describe('DELETE hack with incorrect auth', () => {

    let statusCode: number
    let contentType: string
    let authenticateHeader: string
    let response: JSONApi.TopLevelDocument

    before(async () => {
      const hack = MongoDB.Hacks.createRandomHack()

      const res = await api.delete(`/hacks/${encodeURIComponent(hack.hackid)}`)
        .auth('sack', 'boy')
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      authenticateHeader = res.header['www-authenticate']
      response = res.body
    })

    it('should respond with status code 401 Unauthorised', () => {
      assert.strictEqual(statusCode, 401)
    })

    it('should respond with WWW-Authenticate header for basic realm "Attendee access"', () => {
      assert.strictEqual(authenticateHeader, 'Basic realm="Attendee access", error="Bad username or password"')
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should respond with the expected "Unauthorized" error', () => {
      assert.strictEqual(response.errors.length, 1)
      assert.strictEqual(response.errors[0].status, '401')
      assert.strictEqual(response.errors[0].title, 'Unauthorized')
      assert.strictEqual(response.errors[0].detail, 'Bad username or password')
    })
  })

})
