
const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const products = require('../routes/products');
const error = require('../middlewares/error');
const CONSTANTS = require('../constants');

module.exports = (app) => {
    app.use(compression());
    app.use(helmet());
    app.use(morgan(CONSTANTS.HTTP_LOG_LEVEL.DEVELOPMENT));
    app.use(express.static(path.join(__dirname, 'public')));

    app.use('/api/products', products);
    app.use(error);
}