const express = require('express');
const router = express.Router();
const { Product } = require('../models/product');
const { parseAndGetDBReq } = require('./utils/input_parsers/product');
const { deleteStateMedia } = require('./utils/deleteStaleMedia');
const asyncMiddleware  = require('../middlewares/async');
const auth  = require('../middlewares/auth');
const productsHTTPReqParserDebugger = require('debug')('app:routes:products');

router.get('/', auth, asyncMiddleware(async (req, res) => {
    
    const products = await Product.find()
    .select({
        'varients.productTitle': 1,
        'varients.skuID': 1,
        'varients.isActive': 1,
        'varients.listPrice': 1,
        'varients.size': 1,
        'varients.color': 1,
        'varients.media.path': 1
    });
    
    res.set({'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTION'});
    res.status(200).send(products);

    return;
}));

router.get('/:id', auth, asyncMiddleware(async (req, res) => {
    res.set({'Content-Type': 'application/json; charset=utf-8'});
    const id = req.params.id;

    //query product
    const product = await Product.findById(id);

    // if not found return 404
    if(!product) return res.status(404).send({error: `product with id ${id} not found`});
    
    //everthing is fine
    res.status(200).send(product);
}));

router.post('/', auth, asyncMiddleware(async (req, res, next) => {
    res.set('Content-Type', 'application/json; charset=utf-8');

    //validate and parse req to get db commands
    const { productDetails, error } = await parseAndGetDBReq(req, 'POST');

    //if error return
    if(error) return res.status(400).send({error: error.msg});
    
    //create product and save
    let product = new Product(productDetails);
    product = await product.save();

    //set the location of the resource in header and send response
    res.location(`/products/${product.id}`);
    res.status(201).send(product);
}));

router.put('/:id', auth,asyncMiddleware(async (req, res) => {
    res.set('Content-Type', 'application/json; charset=utf-8');
    const id = req.params.id;

    //validate and parse req to get db commands
    const {productDetails, staleMedia, error } = await parseAndGetDBReq(req, 'PUT');

    //if error return
    if(error) return res.status(400).send({error: error.msg});

    //execute updates
    const product = await Product.findByIdAndUpdate(id, productDetails, { new: true});

    //if no product found return 404
    if(!product) return res.status(404).send({error: `product with id ${id} not found`});
    
    //everything is fine
    res.status(200).send(product);
    
    //delete staleMedia media
    deleteStateMedia(staleMedia);  
}));

router.patch('/:id', auth, asyncMiddleware(async (req, res) => {
    res.set('Content-Type', 'application/json; charset=utf-8');
    const id = req.params.id, updatePromises = [];

    //validate and parse req to get db commands
    var {dbCmds, staleMedia, error} = await parseAndGetDBReq(req, 'PATCH');

    //if error return
    if(error) return res.status(400).send({error: error.msg});

    //execute db commands is transaction
    const session = await Product.startSession();
    session.startTransaction();
    dbCmds.forEach((cmd) => {updatePromises.push(Product.findOneAndUpdate({_id: id}, cmd.query, cmd.options));});
    
    try {
        var product = await Promise.all(updatePromises);
    }
    catch(e) {
        await session.abortTransaction();
        session.endSession();
        throw e;
    }
    
    await session.abortTransaction();
    session.endSession();

    product = product[product.length - 1]

    if(!product) return res.status(400).send({error: `product with id ${id} not found`});
    
    //everything is fine
    res.status(200).send({success: 'Product updated'}); // can also resturn the resource
    
    //delete staleMedia media
    deleteStateMedia(staleMedia);
}));

router.delete('/:id', auth, asyncMiddleware(async (req, res) => {
    /**
     * TODO:: Deciding on soft delete vs hard delete
     */

     console.log('Not implemented yet')
}));

module.exports = router;

