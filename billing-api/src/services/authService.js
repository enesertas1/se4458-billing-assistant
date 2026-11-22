const bcrypt = require('bcryptjs');
const { ApiError } = require('../errors');

// Login: checks the password hash and issues a JWT (signing is done by the auth middleware module).
function createAuthService(repo, auth) {
  return {
    async login({ username, password }) {
      const user = await repo.findUser(username);
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect');
      }
      return {
        accessToken: auth.sign(user),
        tokenType: 'Bearer',
        expiresIn: 3600,
        role: user.role,
        subscriberNo: user.subscriberNo || null,
      };
    },
  };
}

module.exports = { createAuthService };
