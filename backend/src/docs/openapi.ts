/** Hand-written OpenAPI document, served at /api/docs and /api/docs.json. */

type Schema = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: Schema) => ({ 'application/json': { schema } });
const body = (schema: Schema) => ({ required: true, content: json(schema) });
const ok = (description: string, schema: Schema = { type: 'object' }) => ({
  description,
  content: json({ type: 'object', properties: { data: schema } }),
});
const noContent = { description: 'No content' };
const errors = (...codes: number[]) =>
  Object.fromEntries(codes.map((code) => [code, { $ref: `#/components/responses/E${code}` }]));

const pathParam = (name: string, description = name) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' },
});
const queryParam = (name: string, schema: Schema = { type: 'string' }, description?: string) => ({
  name,
  in: 'query',
  schema,
  ...(description ? { description } : {}),
});
const pageParams = [
  queryParam('page', { type: 'integer', minimum: 1, default: 1 }),
  queryParam('pageSize', { type: 'integer', minimum: 1, maximum: 100, default: 20 }),
];

const adminOnly = [{ bearerAuth: [] }];
const either = [{ bearerAuth: [] }, { basicAuth: [] }];
const noAuth: unknown[] = [];
const appKeyAuth = [{ appKey: [] }];
const deviceAuth = [{ registrationId: [], deviceSecret: [] }];

const op = (
  tag: string,
  summary: string,
  responses: Schema,
  extra: Schema = {},
  security: unknown[] = either,
) => ({ tags: [tag], summary, security, responses, ...extra });

const platform = { type: 'string', enum: ['ANDROID', 'IOS', 'HARMONYOS'] };
const addRemove = {
  type: 'object',
  properties: {
    add: { type: 'array', items: { type: 'string' } },
    remove: { type: 'array', items: { type: 'string' } },
  },
};

/** Paths under an environment; they exist both by environment ID and for AppKey clients. */
const environmentPaths: Record<string, Schema> = {
  '': {
    get: op('Environments', 'Get configuration, inherited metadata and usage', {
      200: ok('Environment', ref('Environment')),
      ...errors(401, 403, 404, 429),
    }),
  },
  '/config': {
    patch: op(
      'Environments',
      'Update callback, security and integration settings for this environment only',
      { 200: ok('Updated environment', ref('Environment')), ...errors(400, 401, 403, 429) },
      { requestBody: body(ref('EnvironmentConfig')) },
    ),
  },
  '/credentials/rotate': {
    post: op('Environments', 'Rotate the Master Secret; the new secret is shown once', {
      200: ok('New credentials', ref('Credentials')),
      ...errors(401, 403, 429),
    }),
  },
  '/devices': {
    get: op(
      'Devices',
      'List devices',
      { 200: ok('Devices', { type: 'array', items: ref('Device') }), ...errors(400, 401) },
      {
        parameters: [
          ...pageParams,
          queryParam('platform', platform),
          queryParam('status', { type: 'string', enum: ['ACTIVE', 'INACTIVE'] }),
          queryParam('online', { type: 'string', enum: ['true', 'false'] }),
          queryParam('tag'),
          queryParam('alias'),
          queryParam('appVersion'),
          queryParam('search', { type: 'string' }, 'Part of a registration ID'),
        ],
      },
    ),
    post: op(
      'Devices',
      'Register a device',
      { 201: ok('Device', ref('Device')), ...errors(400, 401, 403, 409, 429) },
      { requestBody: body(ref('RegisterDevice')) },
    ),
  },
  '/devices/cleanup': {
    post: op(
      'Devices',
      'Delete devices inactive for N days, or preview with dryRun',
      { 200: ok('Cleanup result'), ...errors(400, 401, 403) },
      {
        requestBody: body({
          type: 'object',
          required: ['inactiveDays'],
          properties: { inactiveDays: { type: 'integer', minimum: 1 }, dryRun: { type: 'boolean' } },
        }),
      },
    ),
  },
  '/devices/{registrationId}': {
    parameters: [pathParam('registrationId')],
    get: op('Devices', 'Get a device', { 200: ok('Device', ref('Device')), ...errors(401, 404) }),
    patch: op(
      'Devices',
      'Update a device',
      { 200: ok('Device', ref('Device')), ...errors(400, 401, 404) },
      {
        requestBody: body({
          type: 'object',
          properties: {
            vendor: { type: 'string' },
            model: { type: 'string' },
            osVersion: { type: 'string' },
            appVersion: { type: 'string' },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
            online: { type: 'boolean' },
          },
        }),
      },
    ),
    delete: op('Devices', 'Delete a device', { 204: noContent, ...errors(401, 404) }),
  },
  '/devices/{registrationId}/tags': {
    parameters: [pathParam('registrationId')],
    put: op(
      'Tags and aliases',
      'Add or remove tags on a device; unknown tags are created',
      { 200: ok('Device', ref('Device')), ...errors(400, 401, 404, 409) },
      { requestBody: body(addRemove) },
    ),
  },
  '/devices/{registrationId}/alias': {
    parameters: [pathParam('registrationId')],
    put: op(
      'Tags and aliases',
      'Set or clear the alias of a device',
      { 200: ok('Device', ref('Device')), ...errors(400, 401, 404) },
      {
        requestBody: body({
          type: 'object',
          required: ['alias'],
          properties: { alias: { type: 'string', nullable: true } },
        }),
      },
    ),
  },
  '/tags': {
    get: op(
      'Tags and aliases',
      'List tags with device counts',
      { 200: ok('Tags'), ...errors(401) },
      { parameters: pageParams },
    ),
    post: op(
      'Tags and aliases',
      'Create a tag',
      { 201: ok('Tag'), ...errors(400, 401, 409) },
      {
        requestBody: body({
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        }),
      },
    ),
  },
  '/tags/{name}': {
    parameters: [pathParam('name')],
    delete: op('Tags and aliases', 'Delete a tag', { 204: noContent, ...errors(401, 404) }),
  },
  '/tags/{name}/devices': {
    parameters: [pathParam('name')],
    post: op(
      'Tags and aliases',
      'Add or remove devices on a tag, by registration ID',
      { 204: noContent, ...errors(400, 401, 404, 409) },
      { requestBody: body(addRemove) },
    ),
  },
  '/aliases': {
    get: op(
      'Tags and aliases',
      'List aliases and their devices',
      { 200: ok('Aliases'), ...errors(401) },
      { parameters: pageParams },
    ),
  },
  '/aliases/{name}': {
    parameters: [pathParam('name')],
    delete: op('Tags and aliases', 'Delete an alias', { 204: noContent, ...errors(401, 404) }),
  },
  '/messages': {
    get: op(
      'Messages',
      'List messages with funnel summaries',
      { 200: ok('Messages', { type: 'array', items: ref('Message') }), ...errors(400, 401) },
      {
        parameters: [
          ...pageParams,
          queryParam('status'),
          queryParam('type'),
          queryParam('strategy'),
          queryParam('msgid'),
          queryParam('search'),
        ],
      },
    ),
    post: op(
      'Messages',
      'Create a message: sends now, or schedules when scheduledAt is present',
      {
        200: ok('Idempotent replay of an earlier request', ref('Message')),
        201: ok('Created', ref('Message')),
        ...errors(400, 401, 403, 409, 429),
      },
      {
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            schema: { type: 'string' },
            description: 'Repeating a request with this key does not send it again',
          },
        ],
        requestBody: body(ref('CreateMessage')),
      },
    ),
  },
  '/messages/{msgid}': {
    parameters: [pathParam('msgid')],
    get: op('Messages', 'Get a message by msgid', {
      200: ok('Message', ref('Message')),
      ...errors(401, 404),
    }),
  },
  '/messages/{msgid}/targets': {
    parameters: [pathParam('msgid'), ...pageParams],
    get: op('Messages', 'List recipients with attempts and events', {
      200: ok('Targets'),
      ...errors(401, 404),
    }),
  },
  '/messages/{msgid}/attempts': {
    parameters: [pathParam('msgid'), ...pageParams],
    get: op('Messages', 'List delivery attempts', { 200: ok('Attempts'), ...errors(401, 404) }),
  },
  '/messages/{msgid}/events': {
    parameters: [pathParam('msgid')],
    post: op(
      'Messages',
      'Record simulated events on simulated targets. Real devices are never affected',
      { 200: ok('Result'), ...errors(400, 401, 404, 409) },
      {
        requestBody: body({
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string', enum: ['DELIVERED', 'DISPLAYED', 'CLICKED'] },
            registrationIds: { type: 'array', items: { type: 'string' } },
            count: { type: 'integer', minimum: 1 },
          },
        }),
      },
    ),
  },
  '/schedules': {
    get: op(
      'Scheduled messages',
      'List scheduled jobs. Create them with POST /messages and scheduledAt',
      { 200: ok('Jobs'), ...errors(400, 401) },
      { parameters: [...pageParams, queryParam('status')] },
    ),
  },
  '/schedules/{jobId}/cancel': {
    parameters: [pathParam('jobId')],
    post: op('Scheduled messages', 'Cancel a pending job', {
      200: ok('Cancelled job'),
      ...errors(401, 404, 409),
    }),
  },
  '/analytics': {
    get: op(
      'Analytics',
      'Environment analytics: funnel, rates, loss, breakdowns and trend',
      { 200: ok('Analytics'), ...errors(400, 401) },
      {
        parameters: [
          queryParam('from', { type: 'string', format: 'date' }, 'Local date; default 29 days ago'),
          queryParam('to', { type: 'string', format: 'date' }, 'Local date; default today'),
          queryParam('granularity', { type: 'string', enum: ['day', 'month'], default: 'day' }),
          queryParam(
            'deliveryMode',
            { type: 'string', enum: ['REAL', 'SIMULATED'] },
            'Limit figures to real devices or to simulated records',
          ),
          queryParam('platform', platform),
          queryParam('channel', { type: 'string' }, 'For example fcm or mtpush'),
        ],
      },
    ),
  },
  '/analytics/overview': {
    get: op(
      'Analytics',
      "Today and yesterday by hour, yesterday's funnel, and the notification permission rate",
      { 200: ok('Overview'), ...errors(401) },
    ),
  },
  '/analytics/users': {
    get: op(
      'Analytics',
      'New, online and active users, by platform, vendor and app version',
      { 200: ok('User statistics'), ...errors(400, 401) },
      {
        parameters: [
          queryParam('from', { type: 'string', format: 'date' }),
          queryParam('to', { type: 'string', format: 'date' }),
          queryParam('granularity', { type: 'string', enum: ['day', 'month'], default: 'day' }),
          queryParam('platform', platform),
        ],
      },
    ),
  },
  '/analytics/messages/{msgid}': {
    parameters: [pathParam('msgid')],
    get: op(
      'Analytics',
      'Analytics for one msgid, with loss and two-level failure reasons',
      { 200: ok('Message analytics'), ...errors(400, 401, 404) },
      { parameters: [queryParam('platform', platform), queryParam('channel')] },
    ),
  },
};

const scopedPaths = Object.fromEntries(
  Object.entries(environmentPaths).flatMap(([path, item]) => {
    const { parameters = [], ...operations } = item as { parameters?: unknown[] };
    return [
      [
        `/api/v1/environments/{envId}${path}`,
        { parameters: [pathParam('envId', 'Environment ID'), ...parameters], ...operations },
      ],
      [
        `/api/v1/open${path}`,
        {
          parameters,
          ...Object.fromEntries(
            Object.entries(operations).map(([method, operation]) => [
              method,
              { ...(operation as object), security: [{ basicAuth: [] }] },
            ]),
          ),
        },
      ],
    ];
  }),
);

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'EngageLab AppPush (Local Assessment) API',
    version: '1.0.0',
    description: [
      'Local implementation of a push management platform.',
      '',
      '**Delivery:** devices registered through the Android app receive real notifications through Firebase Cloud Messaging. Every other channel is a simulator, and devices created through the admin API are simulated records. Attempts and targets say which is which.',
      '',
      '**Funnel:** `sent` means the provider accepted the message. For a real device, `delivered`, `displayed` and `clicked` come only from the device itself.',
      '',
      '**Authentication**',
      '- Console: `POST /api/v1/auth/login`, then use the token with **bearerAuth**.',
      '- API clients: **basicAuth** with `AppKey` as the username and `Master Secret` as the password.',
      '- Device client: **appKey** to register, then **registrationId** and **deviceSecret**.',
      '',
      '**Conventions:** errors are `{ error: { code, message, details?, requestId } }`. Lists return `{ data, meta }`.',
      '',
      'Each `/environments/{envId}` path also exists under `/open`, where the environment comes from the Basic credentials.',
    ].join('\n'),
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'System' },
    { name: 'Auth' },
    { name: 'Applications' },
    { name: 'Environments' },
    { name: 'Devices' },
    { name: 'Tags and aliases' },
    { name: 'Messages' },
    { name: 'Scheduled messages' },
    { name: 'Analytics' },
    { name: 'Device client', description: 'Called by the Android app, not by servers' },
  ],
  paths: {
    '/api/v1/client/ping': {
      get: op(
        'Device client',
        'Test connectivity and report the setup; device headers are optional',
        { 200: ok('Status'), ...errors(401, 403, 429) },
        {},
        appKeyAuth,
      ),
    },
    '/api/v1/client/devices': {
      post: op(
        'Device client',
        'Register this installation, or update it when X-Device-Secret proves it is the same one',
        {
          200: ok('Updated', ref('ClientDevice')),
          201: ok('Created. deviceSecret is shown only here', ref('ClientDevice')),
          ...errors(400, 401, 403, 409, 429),
        },
        { requestBody: body(ref('ClientRegistration')) },
        appKeyAuth,
      ),
    },
    '/api/v1/client/devices/me/token': {
      put: op(
        'Device client',
        'Replace the FCM token after a refresh; also revives an invalid token',
        { 200: ok('Device', ref('ClientDevice')), ...errors(400, 401, 403, 429) },
        {
          requestBody: body({
            type: 'object',
            required: ['pushToken'],
            properties: { pushToken: { type: 'string' } },
          }),
        },
        deviceAuth,
      ),
    },
    '/api/v1/client/events': {
      post: op(
        'Device client',
        'Report what happened to a message on this device. Repeats are ignored',
        { 200: ok('Whether the report was new'), ...errors(400, 401, 403, 404, 429) },
        { requestBody: body(ref('ClientEvent')) },
        deviceAuth,
      ),
    },
    '/api/health': {
      get: op(
        'System',
        'Health of the API, database and worker',
        { 200: { description: 'Healthy' }, 503: { description: 'Database unavailable' } },
        {},
        noAuth,
      ),
    },
    '/api/v1/auth/login': {
      post: op(
        'Auth',
        'Log in as an admin user',
        { 200: ok('Token and user'), ...errors(400, 401, 429) },
        {
          requestBody: body({
            type: 'object',
            required: ['email', 'password'],
            properties: {
              email: { type: 'string', format: 'email' },
              password: { type: 'string', format: 'password' },
            },
          }),
        },
        noAuth,
      ),
    },
    '/api/v1/auth/me': {
      get: op('Auth', 'Current user', { 200: ok('User'), ...errors(401) }, {}, adminOnly),
    },
    '/api/v1/auth/change-password': {
      post: op(
        'Auth',
        'Change the current password',
        { 204: noContent, ...errors(400, 401) },
        {
          requestBody: body({
            type: 'object',
            required: ['currentPassword', 'newPassword'],
            properties: {
              currentPassword: { type: 'string', format: 'password' },
              newPassword: { type: 'string', format: 'password', minLength: 10 },
            },
          }),
        },
        adminOnly,
      ),
    },
    '/api/v1/audit-logs': {
      get: op(
        'System',
        'List audit records',
        { 200: ok('Audit records'), ...errors(401) },
        { parameters: pageParams },
        adminOnly,
      ),
    },
    '/api/v1/apps': {
      get: op(
        'Applications',
        'List applications',
        { 200: ok('Applications'), ...errors(401) },
        {
          parameters: [
            ...pageParams,
            queryParam('search'),
            queryParam('status', { type: 'string', enum: ['ACTIVE', 'INACTIVE'] }),
          ],
        },
        adminOnly,
      ),
      post: op(
        'Applications',
        'Create an application and its production environment; the secret is shown once',
        { 201: ok('Application and credentials'), ...errors(400, 401, 403) },
        { requestBody: body(ref('ApplicationInput')) },
        adminOnly,
      ),
    },
    '/api/v1/apps/{id}': {
      parameters: [pathParam('id')],
      get: op(
        'Applications',
        'Get an application with its environments',
        { 200: ok('Application'), ...errors(401, 404) },
        {},
        adminOnly,
      ),
      patch: op(
        'Applications',
        'Update shared metadata, which applies to every environment',
        { 200: ok('Application'), ...errors(400, 401, 403, 404, 409) },
        { requestBody: body(ref('ApplicationInput')) },
        adminOnly,
      ),
    },
    '/api/v1/apps/{id}/deactivate': {
      parameters: [pathParam('id')],
      post: op('Applications', 'Deactivate', { 200: ok('Application'), ...errors(401, 403, 404) }, {}, adminOnly),
    },
    '/api/v1/apps/{id}/activate': {
      parameters: [pathParam('id')],
      post: op('Applications', 'Reactivate', { 200: ok('Application'), ...errors(401, 403, 404) }, {}, adminOnly),
    },
    '/api/v1/apps/{id}/testing-environment': {
      parameters: [pathParam('id')],
      post: op(
        'Applications',
        'Create the linked testing environment; the secret is shown once',
        { 201: ok('Application and credentials'), ...errors(401, 403, 404, 409) },
        {},
        adminOnly,
      ),
    },
    ...scopedPaths,
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      basicAuth: { type: 'http', scheme: 'basic', description: 'AppKey:MasterSecret' },
      appKey: { type: 'apiKey', in: 'header', name: 'X-App-Key' },
      registrationId: { type: 'apiKey', in: 'header', name: 'X-Registration-Id' },
      deviceSecret: { type: 'apiKey', in: 'header', name: 'X-Device-Secret' },
    },
    responses: Object.fromEntries(
      (
        [
          [400, 'Validation failed'],
          [401, 'Missing or invalid authentication'],
          [403, 'Forbidden, or the application is inactive or expired'],
          [404, 'Not found'],
          [409, 'Conflict: duplicate, limit reached or invalid state'],
          [429, 'Rate limit exceeded; see Retry-After'],
        ] as const
      ).map(([code, description]) => [
        `E${code}`,
        { description, content: json(ref('Error')) },
      ]),
    ),
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string' },
              details: {},
              requestId: { type: 'string' },
            },
          },
        },
      },
      ApplicationInput: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', example: 'Demo Shop' },
          description: { type: 'string' },
          iconUrl: { type: 'string', format: 'uri' },
          isVip: { type: 'boolean' },
          serviceValidUntil: { type: 'string', format: 'date-time' },
          timezone: { type: 'string', example: 'Asia/Shanghai' },
        },
      },
      Credentials: {
        type: 'object',
        properties: {
          appKey: { type: 'string' },
          masterSecret: { type: 'string', description: 'Shown only in this response' },
          notice: { type: 'string' },
        },
      },
      EnvironmentConfig: {
        type: 'object',
        properties: {
          callbackUrl: { type: 'string', format: 'uri', nullable: true },
          callbackEnabled: { type: 'boolean' },
          ipAllowlist: { type: 'array', items: { type: 'string' } },
          enabledChannels: { type: 'array', items: { type: 'string' } },
          simulatorConfig: {
            type: 'object',
            description: 'Per-channel simulator behaviour',
            example: { fcm: { mode: 'fail', failureReason: 'FCM_DOWN' } },
          },
        },
      },
      Environment: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          type: { type: 'string', enum: ['PRODUCTION', 'TESTING'] },
          appKey: { type: 'string' },
          callbackUrl: { type: 'string', nullable: true },
          enabledChannels: { type: 'array', items: { type: 'string' } },
          limits: { type: 'object', nullable: true },
          credential: { type: 'object', description: 'Hint only; never the secret' },
          shared: { type: 'object', description: 'Metadata shared across environments' },
        },
      },
      RegisterDevice: {
        type: 'object',
        required: ['platform', 'appVersion'],
        properties: {
          registrationId: { type: 'string', description: 'Generated when omitted' },
          platform,
          vendor: { type: 'string', example: 'xiaomi' },
          model: { type: 'string' },
          osVersion: { type: 'string' },
          appVersion: { type: 'string', example: '2.1.0' },
          online: { type: 'boolean' },
        },
      },
      Device: {
        type: 'object',
        properties: {
          registrationId: { type: 'string' },
          platform,
          vendor: { type: 'string', nullable: true },
          appVersion: { type: 'string' },
          status: { type: 'string' },
          online: { type: 'boolean' },
          lastActiveAt: { type: 'string', format: 'date-time' },
          alias: { type: 'string', nullable: true },
          tags: { type: 'array', items: { type: 'string' } },
          deliveryMode: {
            type: 'string',
            enum: ['REAL', 'SIMULATED'],
            description: 'REAL devices registered through the app. The push token is never returned',
          },
          pushTokenStatus: { type: 'string', enum: ['ACTIVE', 'INVALID'], nullable: true },
        },
      },
      ClientRegistration: {
        type: 'object',
        required: ['installationId', 'pushToken', 'appVersion'],
        properties: {
          installationId: { type: 'string', description: 'Stable ID created by the app' },
          pushToken: { type: 'string', description: 'FCM registration token' },
          platform: { type: 'string', enum: ['ANDROID'] },
          vendor: { type: 'string', example: 'xiaomi' },
          model: { type: 'string' },
          osVersion: { type: 'string' },
          appVersion: { type: 'string', example: '1.0.0' },
          notificationsEnabled: { type: 'boolean', description: 'Feeds the permission rate' },
        },
      },
      ClientDevice: {
        type: 'object',
        properties: {
          registrationId: { type: 'string' },
          deviceSecret: { type: 'string', nullable: true, description: 'Returned once, at creation' },
          status: { type: 'string' },
          pushTokenStatus: { type: 'string', nullable: true },
        },
      },
      ClientEvent: {
        type: 'object',
        required: ['msgid', 'type'],
        properties: {
          msgid: { type: 'string' },
          type: { type: 'string', enum: ['DELIVERED', 'DISPLAYED', 'CLICKED', 'DISPLAY_FAILED'] },
          occurredAt: { type: 'string', format: 'date-time' },
          reason: { type: 'string', example: 'NOTIFICATIONS_DISABLED' },
        },
      },
      CreateMessage: {
        type: 'object',
        required: ['type', 'platforms', 'audience', 'strategy'],
        properties: {
          type: { type: 'string', enum: ['NOTIFICATION', 'CUSTOM', 'IN_APP'] },
          title: { type: 'string' },
          body: { type: 'string' },
          style: {
            type: 'string',
            enum: ['DEFAULT', 'THUMBNAIL', 'BIG_PICTURE', 'TEXT', 'INBOX', 'CUSTOM'],
          },
          styleConfig: {
            type: 'object',
            description:
              'THUMBNAIL: thumbnailUrl. BIG_PICTURE: pictureUrl. TEXT: bigText. INBOX: lines. CUSTOM: layoutId.',
          },
          customPayload: { type: 'object', description: 'CUSTOM messages only; 4 KB maximum' },
          platforms: { type: 'array', items: platform },
          audience: {
            type: 'object',
            required: ['type'],
            properties: {
              type: { type: 'string', enum: ['ALL', 'REGISTRATION_IDS', 'TAGS', 'ALIASES'] },
              values: { type: 'array', items: { type: 'string' } },
            },
          },
          strategy: {
            type: 'string',
            enum: ['mtpush', 'fcm_mtpush', 'pns_mtpush', 'mtpush_fcm', 'mtpush_pns'],
            description: 'May also be sent as distribution_new, the name in the published API',
          },
          channel: {
            type: 'string',
            description: "Optional. Tries only this channel, instead of the strategy's chain",
            example: 'fcm',
          },
          scheduledAt: {
            type: 'string',
            description: 'Without an offset, read as local time in the application timezone',
            example: '2026-12-01T09:00',
          },
        },
        example: {
          type: 'NOTIFICATION',
          title: 'Flash sale',
          body: 'Everything is 20% off today',
          platforms: ['ANDROID', 'IOS'],
          audience: { type: 'ALL' },
          strategy: 'fcm_mtpush',
        },
      },
      Message: {
        type: 'object',
        properties: {
          msgid: { type: 'string' },
          status: { type: 'string' },
          type: { type: 'string' },
          strategy: { type: 'string' },
          funnel: { type: 'object' },
          isSimulated: { type: 'boolean' },
          idempotentReplay: { type: 'boolean' },
        },
      },
    },
  },
};
