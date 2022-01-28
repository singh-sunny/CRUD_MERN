const winston = require('winston');

const error = (err, req, res, next) => {
    winston.error(error.message, err);
    
    res.status(500).send({error: 'Something went wrong.'});
}

module.exports = error;