const { bucket } = require('../models/database');
const File = require('../models/File');
const Multer = require('multer');
const GridFsStorage = require('multer-gridfs-storage');
const async = require('async');
const nodemailer = require('nodemailer');

/* Error handler for async / await functions */
const catchErrors = (fn) => {
  return function (req, res, next) {
    return fn(req, res, next).catch(next);
  };
};

const storage = new GridFsStorage({
  url: process.env.mongoDBURI,
  file: (req, file) => {
    return new Promise((resolve, reject) => {
      crypto.randomBytes(16, (err, buf) => {
        if (err) {
          return reject(err);
        }
        const filename = buf.toString('hex') + path.extname(file.originalname);
        const fileInfo = {
          filename: filename,
          bucketName: process.env.bucketName,
        };
        resolve(fileInfo);
      });
    });
  },
});

const upload = Multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // no larger than 100mb, you can change as needed.
  },
  fileFilter: (req, file, next) => {
    if (
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('video/')
    ) {
      next(null, true);
    } else {
      next(null, false);
    }
  },
});

const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const savingFile = async (file) => {
  try {
    let files = new File({
      contentType: file.contentType,
      filename: file.filename,
      fileID: file.fileID,
      size: formatBytes(file.size),
    });
    let { id } = await files.save();
    return Promise.resolve(id);
  } catch (error) {
    return Promise.reject(error);
  }
};

const saveFile = async (req, res, next) => {
  if (!req.files) {
    return next();
  }
  await async.parallel([
    async () => {
      if (req.files['avatar']) {
        const file = req.files['avatar'][0];
        req.body.avatar = await savingFile(file);
      }
      return;
    },
    async () => {
      if (req.files['photos']) {
        const photos = req.files['photos'];
        const arrayOfPhoto = [];
        const saveEach = async (photo) => {
          let id = await savingFile(photo);
          arrayOfPhoto.push(id);
        };
        await async.each(photos, saveEach);
        req.body.photos = new Array(...arrayOfPhoto);
      }
      return;
    },
    async () => {
      if (req.files['thumbnail']) {
        const file = req.files['thumbnail'][0];
        req.body.thumbnail = await savingFile(file);
      }
      return;
    },
  ]);
  return next();
};

const deleteFileFromBucket = async (file) => {
  try {
    return await bucket.delete(new mongoose.Types.ObjectId(file.id));
  } catch (error) {
    return Promise.reject(error);
  }
};

const checkAndChangeProfile = async (req, res, next) => {
  const { avatar } = req.profile;
  if (
    (avatar !== undefined && req.body.avatar !== undefined) ||
    (avatar !== undefined && req.url.includes('DELETE'))
  ) {
    await deleteFileReference(avatar);
  }
  return next();
};

const deleteFileReference = async (file) => {
  await async.parallel([
    (callback) => {
      File.findOneAndDelete({
        key: file.key,
      }).exec(callback);
    },
    async () => {
      await deleteFileFromBucket(file);
    },
  ]);
};

const deleteAllFiles = async (req, res, next) => {
  const { photos, thumbnail } = req.post;
  await async.parallel([
    async () => {
      if (req.body.thumbnail !== undefined || req.url.includes('DELETE')) {
        await deleteFileReference(thumbnail);
      }
      return;
    },
    async () => {
      if (req.body.photos !== undefined || req.url.includes('DELETE')) {
        await async.each(photos, deleteFileReference);
      }
      return;
    },
  ]);
  return next();
};

const transport = nodemailer.createTransport({
  service: 'hotmail',
  auth: {
    user: process.env.emailAddress,
    pass: process.env.emailPassword,
  },
});

const sendEmail = async (req, user) => {
  let link = `${req.protocol}://${req.get('host')}/api/verify?id=${user.id}`;
  let message = {
    from: `${process.env.emailAddress} M-Bias Company`,
    to: `${user.email}`,
    subject: 'Please verify your Email to login to M-Bias.',
    html: `<h1>Verify your email</h1>
    <a href="${link}" target="_blank" rel="noopener noreferrer">Click Here</a><br/>
    <h3>Save your User credentials,<h3/>
    <p>Username: ${user.username}, Password: ${user.password}<p/>`,
  };
  try {
    await transport.sendMail(message);
  } catch (error) {
    console.log(error);
  }
};

module.exports = {
  catchErrors,
  upload,
  saveFile,
  checkAndChangeProfile,
  deleteAllFiles,
  sendEmail,
};