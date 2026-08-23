import {
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertThrows,
} from 'jsr:@std/assert@^1.0.15'
import { InternalError } from '@zanix/errors'
import {
  assertServiceAssertionKeyResolvable,
  createRemoteTemplateAuthClient,
  resetRemoteTemplateAuthClient,
} from 'modules/templates/db/remote-backend-auth.ts'

console.error = () => {}

/**
 * `remote-backend-auth.ts` had no dedicated test file at all in this package — its two behaviors
 * (the module-level `createRemoteTemplateAuthClient` cache, and
 * `assertServiceAssertionKeyResolvable`'s pre-flight check) were only ever exercised indirectly,
 * ALWAYS preceded by `resetRemoteTemplateAuthClient()`, in `remote-template-backend.test.ts` and
 * `template-provider-backend-selection.test.ts` — meaning the actual REUSE branch of
 * `createRemoteTemplateAuthClient`'s `cachedAuthClient ??= ...` (a second call, same process, no
 * reset in between) was never observed anywhere. See that function's own doc: `@zanix/auth`'s
 * `createServiceAuthClient` builds a fresh function with its own EMPTY internal token cache on every
 * call — if this module's own cache silently stopped working (e.g. the guard got flipped to always
 * rebuild), every `TemplateProvider#backend()` call in Mode C would re-sign+re-exchange a brand new
 * credential instead of reusing a still-valid one, and no existing test would have caught it.
 */

Deno.test(
  'createRemoteTemplateAuthClient: a second call (no reset in between) returns the SAME cached client instance',
  () => {
    resetRemoteTemplateAuthClient()

    const first = createRemoteTemplateAuthClient({ serviceId: 'billing-service' })
    const second = createRemoteTemplateAuthClient({
      // Even with different options — the module-level cache is a true singleton, never rebuilt
      // from a later call's own arguments, see the function's own doc on why.
      serviceId: 'a-different-service-id',
    })

    assertStrictEquals(second, first)
  },
)

Deno.test(
  'resetRemoteTemplateAuthClient: clears the cache — the next call after a reset builds a genuinely NEW client',
  () => {
    resetRemoteTemplateAuthClient()
    const first = createRemoteTemplateAuthClient({ serviceId: 'billing-service' })

    resetRemoteTemplateAuthClient()
    const second = createRemoteTemplateAuthClient({ serviceId: 'billing-service' })

    assertNotStrictEquals(second, first)
  },
)

Deno.test(
  'assertServiceAssertionKeyResolvable: throws InternalError when no JWK_PRI_<serviceId> is registered',
  () => {
    Deno.env.delete('JWK_PRI_no-such-service')
    Deno.env.delete('JWK_ID_no-such-service')

    assertThrows(
      () => assertServiceAssertionKeyResolvable('no-such-service'),
      InternalError,
      'no-such-service',
    )
  },
)

Deno.test(
  'assertServiceAssertionKeyResolvable: resolves without throwing once a matching JWK_PRI_<serviceId> is registered',
  () => {
    Deno.env.set('JWK_PRI_resolvable-service', 'dummy-base64-key')

    try {
      assertServiceAssertionKeyResolvable('resolvable-service')
    } finally {
      Deno.env.delete('JWK_PRI_resolvable-service')
    }
  },
)

Deno.test(
  'assertServiceAssertionKeyResolvable: resolves the keyed form (JWK_PRI_<serviceId>_<keyId>) via JWK_ID_<serviceId>',
  () => {
    Deno.env.set('JWK_ID_resolvable-service', 'key-2')
    Deno.env.set('JWK_PRI_resolvable-service_key-2', 'dummy-base64-key')
    // Deliberately no bare JWK_PRI_resolvable-service — must resolve the keyed name instead.
    Deno.env.delete('JWK_PRI_resolvable-service')

    try {
      assertServiceAssertionKeyResolvable('resolvable-service')
    } finally {
      Deno.env.delete('JWK_ID_resolvable-service')
      Deno.env.delete('JWK_PRI_resolvable-service_key-2')
    }
  },
)

Deno.test(
  'assertServiceAssertionKeyResolvable: still throws when JWK_ID points at a keyId with no matching JWK_PRI',
  () => {
    Deno.env.set('JWK_ID_resolvable-service', 'key-missing')
    Deno.env.delete('JWK_PRI_resolvable-service_key-missing')
    Deno.env.delete('JWK_PRI_resolvable-service')

    try {
      const error = assertThrows(
        () => assertServiceAssertionKeyResolvable('resolvable-service'),
        InternalError,
      )
      assertEquals(error.code, 'AUTH_SERVICE_ASSERTION_PRIVATE_KEY_MISSING')
    } finally {
      Deno.env.delete('JWK_ID_resolvable-service')
    }
  },
)
