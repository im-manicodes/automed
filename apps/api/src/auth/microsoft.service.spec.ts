import {
  resolveAuthority,
  resolveProfileEmail,
  tokenErrorMessage,
} from './microsoft.service';

describe('resolveProfileEmail', () => {
  it('prefiere mail', () => {
    expect(
      resolveProfileEmail({ mail: 'A@X.com', userPrincipalName: 'u@y.com' }),
    ).toBe('a@x.com');
  });
  it('usa otherMails[0] si mail es null (cuenta personal)', () => {
    expect(
      resolveProfileEmail({
        mail: null,
        otherMails: ['p@outlook.com'],
        userPrincipalName: 'live.com#p@outlook.com',
      }),
    ).toBe('p@outlook.com');
  });
  it('usa el UPN como último recurso', () => {
    expect(resolveProfileEmail({ userPrincipalName: 'u@y.com' })).toBe(
      'u@y.com',
    );
  });
  it('descarta UPN de invitado (#EXT#)', () => {
    expect(
      resolveProfileEmail({
        userPrincipalName: 'a_x.com#EXT#@t.onmicrosoft.com',
      }),
    ).toBe('');
  });
});

describe('resolveAuthority', () => {
  it('vacío -> common', () => {
    expect(resolveAuthority('')).toBe('common');
    expect(resolveAuthority(undefined)).toBe('common');
  });
  it('acepta common/organizations/consumers y GUID; lo demás -> common', () => {
    expect(resolveAuthority('organizations')).toBe('organizations');
    expect(resolveAuthority('consumers')).toBe('consumers');
    const g = '11111111-2222-3333-4444-555555555555';
    expect(resolveAuthority(g)).toBe(g);
    expect(resolveAuthority('raro')).toBe('common');
  });
});

describe('tokenErrorMessage', () => {
  it.each([
    [
      'invalid_request',
      'AADSTS50020: user from other tenant',
      /no está permitida/,
    ],
    ['unauthorized_client', 'AADSTS700016: app not found', /no reconoce/],
    ['consent_required', '', /consentimiento/],
    ['invalid_grant', 'AADSTS65001: consent', /consentimiento/],
    ['invalid_grant', 'AADSTS70000', /caducó/],
    ['otro', '', /No se pudo autenticar/],
  ])('%s %s', (e, d, re) => {
    expect(tokenErrorMessage(e, d)).toMatch(re);
  });
});
