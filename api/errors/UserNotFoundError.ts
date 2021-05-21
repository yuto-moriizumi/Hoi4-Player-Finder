export default class UserNotFoundError extends Error {
  name = 'UserNotFoundError';

  message = 'Every user was not found';
}
