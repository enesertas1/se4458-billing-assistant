const jwt = require('jsonwebtoken');
const { ApiError } = require('../errors');

function createAuth({ jwtSecret, jwtIssuer = 'se4458-billing-api', expiresIn = '1h' }) {
  function sign(user) {
    return jwt.sign(
      { role: user.role, subscriberNo: user.subscriberNo || null },
      jwtSecret,
      { subject: user.username, issuer: jwtIssuer, expiresIn, algorithm: 'HS256' }
    );
  }

  // Requires a valid "Authorization: Bearer <JWT>" header.
  function authenticate(req, _res, next) {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return next(new ApiError(401, 'UNAUTHORIZED', 'Missing or malformed Authorization header (expected: Bearer <token>)'));
    }
    try {
      const payload = jwt.verify(token, jwtSecret, { issuer: jwtIssuer, algorithms: ['HS256'] });
      req.user = { username: payload.sub, role: payload.role, subscriberNo: payload.subscriberNo };
      return next();
    } catch (err) {
      const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
      return next(new ApiError(401, code, 'Access token is invalid or expired'));
    }
  }

  function requireRole(...roles) {
    return (req, _res, next) => {
      if (!roles.includes(req.user.role)) {
        return next(new ApiError(403, 'FORBIDDEN', `This operation requires role: ${roles.join(' or ')}`));
      }
      return next();
    };
  }

  // A SUBSCRIBER may only touch their own subscriber number, no matter what number
  // is written in the request (or in an AI prompt). ADMIN may access any subscriber.
  function requireOwnership(getSubscriberNo) {
    return (req, _res, next) => {
      if (req.user.role === 'ADMIN') return next();
      const requested = getSubscriberNo(req);
      if (req.user.subscriberNo !== requested) {
        return next(new ApiError(403, 'FORBIDDEN', 'You can only access your own subscriber account'));
      }
      return next();
    };
  }

  return { sign, authenticate, requireRole, requireOwnership };
}

module.exports = { createAuth };
