import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { User } from '../models/user.model.js';
import { generateRefreshTokenAndAccessToken } from '../controller/user.controller.js';

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).select('-password -refreshToken');
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  const port = process.env.PORT || 5000;
  let baseUrl = process.env.BASE_URL;
  
  if (!baseUrl || baseUrl.trim() === '' || baseUrl === 'undefined') {
    baseUrl = `http://localhost:${port}`;
  }
  baseUrl = baseUrl.replace(/\/$/, '');
  const callbackURL = `${baseUrl}/api/v1/user/auth/google/callback`;

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: callbackURL,
        scope: ['profile', 'email'],
      },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ oauthId: profile.id, oauthProvider: 'google' });

        if (user) {
          return done(null, user);
        }

        user = await User.findOne({ email: profile.emails[0].value });

        if (user) {
          user.oauthProvider = 'google';
          user.oauthId = profile.id;
          user.emailVerified = true;
          await user.save();
          return done(null, user);
        }

        user = await User.create({
          name: profile.displayName || profile.name.givenName + ' ' + profile.name.familyName,
          email: profile.emails[0].value,
          oauthProvider: 'google',
          oauthId: profile.id,
          emailVerified: true,
          profileImage: profile.photos[0]?.value,
          roles: ['customer'],
          password: '',
        });

        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }
    )
  );
}

if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  const port = process.env.PORT || 5000;
  let baseUrl = process.env.BASE_URL;
  
  if (!baseUrl || baseUrl.trim() === '' || baseUrl === 'undefined') {
    baseUrl = `http://localhost:${port}`;
  }
  baseUrl = baseUrl.replace(/\/$/, '');
  let facebookCallbackURL = process.env.FACEBOOK_CALLBACK_URL;
  if (!facebookCallbackURL || facebookCallbackURL.trim() === '' || facebookCallbackURL === 'undefined') {
    facebookCallbackURL = `${baseUrl}/api/v1/user/auth/facebook/callback`;
  } else if (!facebookCallbackURL.startsWith('http')) {
    facebookCallbackURL = `${baseUrl}${facebookCallbackURL.startsWith('/') ? '' : '/'}${facebookCallbackURL}`;
  }

  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: facebookCallbackURL,
        profileFields: ['id', 'displayName', 'email', 'picture.type(large)'],
      },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ oauthId: profile.id, oauthProvider: 'facebook' });

        if (user) {
          return done(null, user);
        }

        if (profile.emails && profile.emails[0]) {
          user = await User.findOne({ email: profile.emails[0].value });

          if (user) {
            user.oauthProvider = 'facebook';
            user.oauthId = profile.id;
            user.emailVerified = true;
            await user.save();
            return done(null, user);
          }
        }

        user = await User.create({
          name: profile.displayName,
          email: profile.emails?.[0]?.value || `${profile.id}@facebook.temp`,
          oauthProvider: 'facebook',
          oauthId: profile.id,
          emailVerified: !!profile.emails?.[0]?.value,
          profileImage: profile.photos?.[0]?.value,
          roles: ['customer'],
          password: '',
        });

        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }
    )
  );
}

export default passport;

