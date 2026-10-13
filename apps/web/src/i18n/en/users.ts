import { numEn, plural } from '../helpers';
import type { Dict } from '../id';

export const users: Dict['users'] = {
  introAdmin: 'Manage SOLAR accounts: approve registrations, set roles, disable, reset passwords or delete accounts.',
  introHead: 'Approve registrations (as Solar Staff) and disable or enable staff accounts. Other changes are made by a superadmin.',

  filters: {
    label: 'Account status',
    pending: 'Waiting',
    active: 'Active',
    disabled: 'Disabled',
    all: 'All',
  },
  search: {
    placeholder: 'Search users…',
    label: 'Search users',
  },

  status: {
    pending: 'Waiting for approval',
    active: 'Active',
    disabled: 'Disabled',
  },

  you: 'You',
  joined: (date: string) => `Registered ${date}`,
  lastLogin: (time: string) => `Last login ${time}`,
  neverLoggedIn: 'Never logged in',
  count: (n: number) => `${numEn(n)} ${plural(n, 'account')}`,

  empty: {
    pending: 'No registrations waiting. All done!',
    active: 'No active accounts yet.',
    disabled: 'No disabled accounts.',
    all: 'No accounts yet.',
    search: 'No account matches the search.',
  },

  actions: {
    approve: 'Approve',
    approveAs: 'Approve as',
    reject: 'Reject',
    rejectTitle: 'Reject the registration (the account is disabled)',
    disable: 'Disable',
    enable: 'Enable',
    manage: 'Manage',
    manageClose: 'Close',
    manageLabel: (name: string) => `Manage the account of ${name}`,
    role: 'Role',
    saveRole: 'Change role',
    roleHint: 'Changing the role ends every login session of this account.',
    rename: 'Display name',
    saveName: 'Save name',
    resetPassword: 'Reset password',
    resetHint:
      'The old password is never shown. Set a new one, give it to the account owner through a safe channel and ask them to change it. Every session of this account ends.',
    resetDone: (name: string) => `The new password is in effect. Give it to ${name} through a safe channel; they can change it from their account menu.`,
    generate: 'Generate a random password',
    delete: 'Delete account',
    deleteHint: 'Deletes the account and its sessions. Its tasks stay and show as "Deleted user".',
    dangerZone: 'Risky actions',
    readOnly: 'Only a superadmin can change this account.',
    self: 'This is your account: you cannot change its role, status or password, or delete it, from here.',
  },

  done: {
    approved: (name: string, role: string) => `${name} approved as ${role}.`,
    rejected: (name: string) => `${name}'s registration was rejected; the account is disabled.`,
    disabled: (name: string) => `${name} was disabled and logged out.`,
    enabled: (name: string) => `${name} was enabled again.`,
    role: (name: string, role: string) => `${name} is now ${role} and was logged out.`,
    renamed: (name: string) => `Display name changed to ${name}.`,
    passwordReset: (name: string) => `${name}'s password was reset and every session ended.`,
    deleted: (name: string) => `The account of ${name} was deleted.`,
    created: (name: string) => `The account of ${name} was created and is active.`,
  },

  confirmDelete: {
    title: (name: string) => `Delete the account of ${name}?`,
    body: 'The account and all its login sessions are deleted permanently. Tasks it created stay and show as "Deleted user". This cannot be undone.',
    confirm: 'Delete permanently',
  },

  create: {
    button: 'Add user',
    title: 'New user',
    intro: 'Accounts created by a superadmin are active right away, without waiting for approval.',
    submit: 'Create account',
  },

  errors: {
    selfAction: 'You cannot change the role of, disable, reset the password of or delete your own account.',
    lastSuperadmin: 'At least one active superadmin must remain. Make another user a superadmin first.',
    forbidden: 'Your role may not do this to that account.',
    notPending: 'This account is no longer waiting for approval; another admin may have handled it.',
    notFound: 'This account no longer exists; it may have just been deleted.',
  },

  rolesHelp: 'About the roles',
};
