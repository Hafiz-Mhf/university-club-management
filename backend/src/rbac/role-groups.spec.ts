import { MANAGE_EVENTS, MANAGE_MEMBERS } from './role-groups';

describe('MANAGE_EVENTS', () => {
  it('is the create/edit-events matrix row', () => {
    expect(MANAGE_EVENTS).toEqual([
      'PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR', 'COMMITTEE',
    ]);
  });
  it('is MANAGE_MEMBERS plus COMMITTEE', () => {
    expect(MANAGE_EVENTS).toEqual([...MANAGE_MEMBERS, 'COMMITTEE']);
  });
});
