const auth = (req, res, next) => {
    let credentials = req.header('Authorization');

    if(!credentials) return res.status(401).send({error: {code: 401, msg: 'Unauthorized access. No credential provided'}});

    const secureUsername = process.env.USERNAME;
    const securePassword = process.env.PASSWORD;

    credentials = credentials.trim().replace('Basic ', '').split(':')

    if(secureUsername !== credentials[0] || securePassword !== credentials[1]) {
        return res.status(401).send({error: {code: 401, msg: 'Unauthorized access. Invalid username or password'}});
    }
    
    next();    
}

module.exports = auth;