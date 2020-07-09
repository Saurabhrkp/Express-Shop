const User = require('../models/user');
const Product = require('../models/product');
const File = require('../models/file');
const async = require('async');

exports.adminpanel = async (req, res) => {
  const results = await async.parallel({
    users: (callback) => {
      User.countDocuments(callback);
    },
    products: (callback) => {
      Product.countDocuments(callback);
    },
    files: (callback) => {
      File.countDocuments(callback);
    },
  });
  results.create = 'Add Product';
  res.render('admin-panel', { pageTitle: 'Admin Panel', results });
};

exports.createProduct = (req, res) => {
  res.render('product-form', { pageTitle: 'New Product' });
};

exports.sendProduct = async (req, res) => {
  req.body.seller = req.user.id;
  const product = await new Product(req.body).save();
  const user = await User.findById(req.user.id);
  user.products.push(product._id);
  await user.save();
  await Product.populate(product, {
    path: 'seller photos thumbnail',
    select: '_id username avatar contentType filename fileID',
  });
  res.redirect(`/${product.slug}`);
};

exports.sendProductForm = (req, res) => {
  res.render('product-form', {
    pageTitle: `Update Product: ${req.product.title}`,
    product: req.product,
  });
};

exports.getUsers = async (req, res) => {
  const users = await User.find();
  res.render('lists', { pageTitle: 'List of users', users });
};

exports.getProducts = async (req, res) => {
  const products = await Product.find();
  res.render('lists', { pageTitle: 'List of products', products });
};

exports.getFiles = async (req, res) => {
  const files = await File.find();
  res.render('lists', { pageTitle: 'List of files', files });
};

exports.updateProduct = async (req, res) => {
  await Product.findOneAndUpdate(
    { _id: req.product._id },
    { $set: req.body },
    { new: true, runValidators: true }
  );
  req.flash('success_msg', `${req.product.title} updated`);
  res.redirect(`${req.product.slug}`);
};

exports.deleteProduct = async (req, res) => {
  const { _id } = req.product;
  await async.parallel([
    (callback) => {
      User.findOneAndUpdate(req.user.id, { $pull: { products: _id } }).exec(
        callback
      );
    },
    (callback) => {
      Product.findOneAndDelete({ _id }).exec(callback);
    },
  ]);
  req.flash('success_msg', `Deleted ${req.product.tilte}`);
  res.redirect('/admin/panel');
};