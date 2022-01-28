const path = require('path');
const winston = require('winston');

const logging = () => {

    winston.add(new winston.transports.File({filename: 'logfile.log'}));
    winston.add(new winston.transports.Console());
    
    process.on('uncaughtException', (e) => {
        winston.error(e.message, e);
        process.exit(1);
    });
    
    process.on('unhandledRejection', (e) => {
        winston.error(e.message, e);
        process.exit(1);
    });
    
};

module.exports = logging;