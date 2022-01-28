const dbDebugger = require('debug')('app:db');
const config = require('config');
const mongoose = require('mongoose');
const winston = require('winston');

const setupDB = () => {
    const connectionString = `${config.get('DB_SERVER.scheme')}${config.get('DB_SERVER.host')}/${config.get('DB_SERVER.dbName')}`;
    
    mongoose.connect(connectionString)
    .then(() => {
        winston.info('Connected to MongoDB...')
    });
    
};

module.exports = setupDB;