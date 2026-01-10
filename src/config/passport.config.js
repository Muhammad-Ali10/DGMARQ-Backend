import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { User } from '../models/user.model.js';
import { generateRefreshTokenAndAccessToken } from '../controller/user.controller.js';

// Serialize user for session
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

// Google OAuth Strategy (only if credentials are provided)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  // Construct absolute callback URL (backend URL, not frontend)
  // FIX: Ensure BASE_URL is always defined with safe fallbacks to prevent "undefined" in URLs
  const port = process.env.PORT || 5000;
  let baseUrl = process.env.BASE_URL;
  
  // Validate and sanitize BASE_URL to prevent undefined values
  if (!baseUrl || baseUrl.trim() === '' || baseUrl === 'undefined') {
    // Fallback to localhost with port if BASE_URL is missing or invalid
    baseUrl = `http://localhost:${port}`;
    console.warn('⚠️  BASE_URL not set or invalid, using fallback:', baseUrl);
  }
  
  // Remove trailing slash if present to avoid double slashes
  baseUrl = baseUrl.replace(/\/$/, '');
  
  // Static callback URL - never contains dynamic parameters
  const callbackURL = `${baseUrl}/api/v1/user/auth/google/callback`;
  
  // Log the callback URL for debugging (remove in production if sensitive)
  console.log('✅ Google OAuth callback URL:', callbackURL);
  
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: callbackURL, // Static URL - no dynamic parameters
        scope: ['profile', 'email'], // FIX: Set default scope as array to ensure it's always sent to Google
      },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user exists with this Google ID
        let user = await User.findOne({ oauthId: profile.id, oauthProvider: 'google' });

        if (user) {
          return done(null, user);
        }

        // Check if user exists with same email
        user = await User.findOne({ email: profile.emails[0].value });

        if (user) {
          // Link OAuth account to existing user
          user.oauthProvider = 'google';
          user.oauthId = profile.id;
          user.emailVerified = true;
          await user.save();
          return done(null, user);
        }

        // Create new user
        user = await User.create({
          name: profile.displayName || profile.name.givenName + ' ' + profile.name.familyName,
          email: profile.emails[0].value,
          oauthProvider: 'google',
          oauthId: profile.id,
          emailVerified: true,
          profileImage: profile.photos[0]?.value,
          roles: ['customer'],
          password: '', // OAuth users don't need password
        });

        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }
    )
  );
  console.log('✅ Google OAuth Strategy registered successfully');
} else {

  console.log('⚠️  Google OAuth not configured - skipping Google Strategy');
}

// Facebook OAuth Strategy (only if credentials are provided)
if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  // FIX: Construct absolute callback URL for Facebook (was using relative URL)
  const port = process.env.PORT || 5000;
  let baseUrl = process.env.BASE_URL;
  
  // Validate and sanitize BASE_URL to prevent undefined values
  if (!baseUrl || baseUrl.trim() === '' || baseUrl === 'undefined') {
    baseUrl = `http://localhost:${port}`;
    console.warn('⚠️  BASE_URL not set or invalid, using fallback:', baseUrl);
  }
  
  // Remove trailing slash if present
  baseUrl = baseUrl.replace(/\/$/, '');
  
  // Use FACEBOOK_CALLBACK_URL if provided, otherwise construct from BASE_URL
  let facebookCallbackURL = process.env.FACEBOOK_CALLBACK_URL;
  if (!facebookCallbackURL || facebookCallbackURL.trim() === '' || facebookCallbackURL === 'undefined') {
    // Construct absolute URL from BASE_URL
    facebookCallbackURL = `${baseUrl}/api/v1/user/auth/facebook/callback`;
  } else if (!facebookCallbackURL.startsWith('http')) {
    // If relative URL provided, make it absolute
    facebookCallbackURL = `${baseUrl}${facebookCallbackURL.startsWith('/') ? '' : '/'}${facebookCallbackURL}`;
  }
  
  console.log('✅ Facebook OAuth callback URL:', facebookCallbackURL);
  
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: facebookCallbackURL, // Absolute URL - no dynamic parameters
        profileFields: ['id', 'displayName', 'email', 'picture.type(large)'],
      },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user exists with this Facebook ID
        let user = await User.findOne({ oauthId: profile.id, oauthProvider: 'facebook' });

        if (user) {
          return done(null, user);
        }

        // Check if user exists with same email
        if (profile.emails && profile.emails[0]) {
          user = await User.findOne({ email: profile.emails[0].value });

          if (user) {
            // Link OAuth account to existing user
            user.oauthProvider = 'facebook';
            user.oauthId = profile.id;
            user.emailVerified = true;
            await user.save();
            return done(null, user);
          }
        }

        // Create new user
        user = await User.create({
          name: profile.displayName,
          email: profile.emails?.[0]?.value || `${profile.id}@facebook.temp`,
          oauthProvider: 'facebook',
          oauthId: profile.id,
          emailVerified: !!profile.emails?.[0]?.value,
          profileImage: profile.photos?.[0]?.value,
          roles: ['customer'],
          password: '', // OAuth users don't need password
        });

        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }
    )
  );
} else {
  console.log('⚠️  Facebook OAuth not configured - skipping Facebook Strategy');
}

export default passport;

