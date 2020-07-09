// Loading models
const User = require('../models/user');
const passport = require('passport');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { sendEmail } = require('./controlHelper');

exports.get_signup = (req, res) => {
  res.render('signup', {
    pageTitle: 'Create new account',
  });
};

exports.validateSignup = async (req, res, next) => {
  await body('name')
    .trim()
    .isLength({ min: 1 })
    .withMessage(`Name field can't be empty`)
    .run(req);
  await body('username')
    .trim()
    .isLength({ min: 6, max: 16 })
    .withMessage('Username has to be longer than 6.')
    .isAlphanumeric()
    .withMessage('Username has non-alphanumeric characters.')
    .custom(async (value) => {
      const user = await User.findOne({ username: value });
      if (user) {
        throw new Error('Username already in use');
      }
      return true;
    })
    .run(req);
  await body('email')
    .trim()
    .isEmail()
    .normalizeEmail()
    .custom(async (value) => {
      const user = await User.findOne({ email: value });
      if (user) {
        throw new Error('E-mail already in use');
      }
      return true;
    })
    .run(req);
  await body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 chars long')
    .matches(/\d/)
    .withMessage('Password must contain a number')
    .run(req);
  await body('passwordConfirmation')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Password confirmation does not match password');
      }
      return true;
    })
    .run(req);
  const errors = validationResult(req).array();
  if (errors.length > 0) {
    const error = errors.map((error) => error.msg)[0];
    const { name, email, username, password, passwordConfirmation } = req.body;
    return res.render('signup', {
      pageTitle: 'Create new account',
      error,
      name,
      username,
      email,
      password,
      passwordConfirmation,
    });
  }
  next();
};

exports.signup = async (req, res) => {
  const { name, email, password, username } = req.body;
  const user = await new User({ name, email, username, password });
  await sendEmail(req, user);
  let salt = await bcrypt.genSalt(10);
  let hash = await bcrypt.hash(user.password, salt);
  user.password = hash;
  await user.save();
  req.flash('success_msg', 'Registered and check your email for verification');
  res.redirect('/auth/signin');
};

exports.get_signin = (req, res) => {
  res.render('signin', {
    pageTitle: 'Sign in',
  });
};

exports.set_verified = async (req, res, next) => {
  try {
    await User.findOneAndUpdate({ _id: req.params.id }, { verified: true });
    req.flash('success_msg', 'Email Verification Complete');
    res.redirect('/auth/signin');
  } catch (error) {
    next(error);
  }
};

exports.signin = (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return res.render('signin', {
        pageTitle: 'Sign in',
        error: err.message,
      });
    }
    if (!user) {
      return res.render('signin', {
        pageTitle: 'Sign in',
        error: info.message,
      });
    }
    req.logIn(user, (err) => {
      if (err) {
        return res.render('signin', {
          pageTitle: 'Sign in',
          error: err.message,
        });
      }
      res.redirect('/');
    });
  })(req, res, next);
};

exports.signout = (req, res) => {
  req.session.destroy(() => {
    req.logout();
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
};

exports.getAuthUser = (req, res) => {
  res.render('profile', {
    pageTitle: `${req.profile.username}`,
    profile: req.profile,
  });
};

exports.checkAuth = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  req.flash('error_msg', 'You have to be registered and logged in');
  res.redirect('/auth/signin');
};

exports.getUserByUsername = async (req, res, next, username) => {
  try {
    req.profile = await User.findOne({ username: username }).populate({
      path: 'saved',
      select: '-photos -body',
    });
    req.profile.liked = await Product.find({
      likes: { $in: [req.profile._id] },
    }).select('-photos -body -reviews -likes');
    next();
  } catch (error) {
    next(error);
  }
};

exports.toggleSavedProducts = async (req, res) => {
  const user = await User.findOne({ _id: req.user.id });
  const savedIds = user.saved.map((id) => id.toString());
  const productId = req.product._id.toString();
  if (savedIds.includes(productId)) {
    await user.saved.pull(productId);
    req.flash(
      'success_msg',
      `Removed from saved product: ${req.product.title}`
    );
  } else {
    await user.saved.push(productId);
    req.flash('success_msg', `Added to saved product: ${req.product.title}`);
  }
  await user.save();
  res.redirect(`/${req.product.slug}`);
};

exports.updateUser = async (req, res) => {
  req.body.updatedAt = new Date().toISOString();
  await User.findOneAndUpdate(
    { _id: req.user._id },
    { $set: req.body },
    { new: true, runValidators: true }
  );
  req.flash('success_msg', 'Your Account is updated');
  res.redirect(`/auth/${req.user.username}`);
};

exports.deleteUser = async (req, res) => {
  await async.parallel([
    (callback) => {
      User.findByIdAndDelete(req.profile._id).exec(callback);
    },
    (callback) => {
      Product.updateMany(
        { likes: { $in: [req.profile._id] } },
        { $pull: { likes: req.profile._id } }
      ).exec(callback);
    },
  ]);
  res.redirect('/auth/signout');
};

exports.getReset = (req, res) => {
  let message = req.flash('error');
  if (message.length > 0) {
    message = message[0];
  } else {
    message = null;
  }
  req.flash('error_msg', message);
  res.render('auth/reset', {
    pageTitle: 'Reset Password',
  });
};

exports.postReset = async (req, res) => {
  const buffer = await crypto.randomBytes(32);
  const token = buffer.toString('hex');
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    req.flash('error', 'No account with that email found.');
    return res.redirect('/reset');
  }
  user.resetToken = token;
  user.resetTokenExpiration = Date.now() + 3600000;
  await user.save();
  let link = `${req.protocol}://${req.get('host')}/auth/reset/${token}`;
  transporter.sendMail({
    to: req.body.email,
    from: `${process.env.emailAddress} Express Shop`,
    subject: 'Password reset',
    html: `
          <p>You requested a password reset</p>
          <p>Click this <a href="${link}"  target="_blank" rel="noopener noreferrer">link</a> to set a new password.</p>`,
  });
  res.redirect('/');
};

exports.getNewPassword = async (req, res) => {
  const token = req.params.token;
  const user = await User.findOne({
    resetToken: token,
    resetTokenExpiration: { $gt: Date.now() },
  });
  let message = req.flash('error');
  if (message.length > 0) {
    message = message[0];
  } else {
    message = null;
  }
  req.flash('error_msg', message);
  res.render('auth/new-password', {
    pageTitle: 'New Password',
    userId: user._id.toString(),
    passwordToken: token,
  });
};

exports.postNewPassword = async (req, res) => {
  const newPassword = req.body.password;
  const userId = req.body.userId;
  const passwordToken = req.body.passwordToken;
  const user = await User.findOne({
    resetToken: passwordToken,
    resetTokenExpiration: { $gt: Date.now() },
    _id: userId,
  });
  let salt = await bcrypt.genSalt(10);
  let hash = await bcrypt.hash(newPassword, salt);
  user.password = hash;
  user.resetToken = undefined;
  user.resetTokenExpiration = undefined;
  await user.save();
  res.redirect('/auth/login');
};