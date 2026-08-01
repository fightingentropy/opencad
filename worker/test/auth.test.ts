import { describe, expect, it } from 'vitest';
import { roleForAccessClaims, type AccessAuthEnvironment } from '../src/auth';

const env: AccessAuthEnvironment = {
  ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com',
  ACCESS_AUD: 'audience',
  ACCESS_OWNER_EMAILS: 'owner@example.com',
  ACCESS_EDITOR_EMAILS: 'editor@example.com',
  ACCESS_OWNER_GROUPS: 'cad-admins',
  ACCESS_EDITOR_GROUPS: 'cad-editors',
};

describe('Cloudflare Access role mapping', () => {
  it('defaults every authenticated but unmapped identity to viewer', () => {
    expect(roleForAccessClaims({ email: 'reader@example.com' }, env)).toBe('viewer');
  });

  it('maps case-insensitive email and nested group claims', () => {
    expect(roleForAccessClaims({ email: 'OWNER@EXAMPLE.COM' }, env)).toBe('owner');
    expect(roleForAccessClaims({ email: 'person@example.com', custom: { groups: ['CAD-EDITORS'] } }, env)).toBe('editor');
  });

  it('gives owner mappings precedence over editor mappings', () => {
    expect(roleForAccessClaims({
      email: 'editor@example.com',
      groups: ['cad-admins'],
    }, env)).toBe('owner');
  });
});
