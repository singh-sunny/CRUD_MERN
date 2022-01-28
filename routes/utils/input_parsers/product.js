const multiparty = require('multiparty');
const config = require('config');
const {validateHTTPReqPayload} = require('../../../models/product');
const productsHTTPReqPayloadParserDebugger = require('debug')('app:routes:req:parser:products');


const parseAndGetDBReq = (httpReq, httpMethod) => {

    let dbReq = null;

    switch(httpMethod) {
        case 'POST': 
            dbReq = parsePostPutReq(httpReq)
            break;
        case 'PUT': 
            dbReq = parsePostPutReq(httpReq, true)
            break;
        case 'PATCH': 
            dbReq = parsePatchReq(httpReq)
            break;
        default:
            productsHTTPReqPayloadParserDebugger(`parser not implemented for ${httpMethod}`);
            dbReq = null;
    }

    return dbReq;
}

const parsePostPutReq = (httpRequest, isPut=false) => {

    const parsePromise = new Promise((resolve, reject) => {
        const form = new multiparty.Form({uploadDir: config.media_directory});
        
        let productDetails = null;
        const productMedia = {};
        const oldMedia = {};

        form.on('field', (name, value) => {
            if(name === 'productDetails') {
                try {
                    productDetails = JSON.parse(value)
                }
                catch(e) {
                    resolve({error: {code: 400, msg: `Bad Input ${e.message}`}});
                }
            }
        });

        form.on('file', (name, file) => {
            const detail = {
                filedName: name,
                originalFilename: file.originalFilename,
                path: file.path.replaceAll('\\', '/')
            }

            if(productMedia[name]) {
                productMedia[name].push(detail)
            }
            else {
                productMedia[name] = [detail]
            }
        });

        form.on('close', async () => {
            const httpMethod = isPut ? 'PUT' : 'POST';
            const { error } = validateHTTPReqPayload(productDetails, productMedia, httpMethod);
            
            if(error) {
                resolve({error: {code: 400, msg: `Bad Input ${error.message || error.details[0].message}`}})
                return;
            }

            productDetails.varients.forEach((v) => {
                oldMedia[v.skuID] = v.media;

                v.media = [];

                productMedia[v.skuID].forEach((m) => {
                    v.media.push({
                        originalFilename: m.originalFilename,
                        path: m.path
                    })
                })
            });

            resolve({productDetails: productDetails, staleMedia: oldMedia});
        });

        form.on('error', (err) => {
            resolve({error: {code: 400, msg: `Bad Input ${err.stack}`}});
        });

        form.parse(httpRequest);
    });

    return parsePromise;
}

const parsePatchReq = (httpRequest) => {
    const parsePromise = new Promise((resolve, reject) => {
        const form = new multiparty.Form({uploadDir: config.media_directory});
        
        let productDetails = null;
        const productMedia = {};
        const staleMedia = [];

        form.on('field', (name, value) => {
            if(name === 'productDetails') {
                try {
                    productDetails = JSON.parse(value);
                }
                catch(e) {
                    resolve({error: {code: 400, msg: `Bad Input ${e.message}`}});
                }
                
            }
        });

        form.on('file', (name, file) => {
            const detail = {
                fieldName: name,
                originalFilename: file.originalFilename,
                path: file.path.replaceAll('\\', '/')
            }

            if(productMedia[name]) {
                productMedia[name].push(detail)
            }
            else {
                productMedia[name] = [detail]
            }
        });

        form.on('close', async () => {
            const { error } = validateHTTPReqPayload(productDetails, productMedia, 'PATCH');

            let dbCmds = [];

            if(error) {
                resolve({error: {code: 400, msg: `Bad Input ${error.details[0].message}`}});
                return;
            }

            const delCmd = _patchGetDeleteSubDocumentsDBCmd(productDetails);
            delCmd ? dbCmds.push(delCmd) : null;

            const createCmd = _pathcGetCreateSubDocumentsDBCmd(productDetails, productMedia);
            createCmd ? dbCmds.push(createCmd) : null;

            const updateCmds = _pathGetUpdateSubDocumentsDBCmd(productDetails, productMedia);
            
            dbCmds = updateCmds ? [...dbCmds, ...updateCmds] : dbCmds;

            if(productDetails.deleteMediaForDeletedVarients) {
                staleMedia = [...productDetails.deleteMediaForDeletedVarients];
            }
            if(productDetails.deleteMediaForUpdatedVarients) {
                staleMedia = [...staleMedia ,...productDetails.deleteMediaForUpdatedVarients];
            }
            
            
            resolve({dbCmds: dbCmds, staleMedia: staleMedia});
        });

        form.on('error', (err) => {
            resolve({error: {code: 400, msg: `Bad Input ${err.stack}`}})
        });

        form.parse(httpRequest);
    });

    return parsePromise;
}

const _patchGetDeleteSubDocumentsDBCmd = (productDetails) => {
        const faq = productDetails.faq;
        const varients = productDetails.varients;
        
        if((faq && faq.delete)|| (varients && varients.delete)) {
            const delExp = {$pull: {}};

            faq && faq.delete ? delExp.$pull.faq = {  _id: {  $in: faq.delete } } : null;
            varients && varients.delete ? delExp.$pull.varients = {  _id: {  $in: varients.delete } } : null;

            return {query: delExp, options: {new: true, runValidators: true}};
        }

        return null;
}

const _pathcGetCreateSubDocumentsDBCmd = (productDetails, productMedia) => {

    const faq = productDetails.faq;
    const varients = productDetails.varients;

    if(varients && varients.create) {
        varients.create.forEach((v) => {
            productMedia[v.skuID].forEach((m) => {
                v.media = [];
                v.media.push({
                    originalFilename: m.originalFilename,
                    path: m.path
                });
            })
        })
    }

    if((faq && faq.create)|| (varients && varients.create)) {
        const createExp = {$push: {}};

        faq && faq.create ? createExp.$push.faq = {  $each: faq.create } : null;
        varients && varients.create ? createExp.$push.varients = {  $each: varients.create } : null;

        return {query: createExp, options: {new: true, runValidators: true}};
    }

    return null;
}

const _pathGetUpdateSubDocumentsDBCmd = (productDetails, productMedia) => {
    const updateCmds = [];

    const {faq, varients} = productDetails;

    const faqEntries = faq && faq.update ? faq.update : [];
    const varientEntries = varients && varients.update ? varients.update : [];
    const deleteMediaForUpdatedVarients = varients && varients.deleteMediaForUpdatedVarients ? varients.deleteMediaForUpdatedVarients : [];

    // set text key: value
    faqEntries.forEach((entry) => {
        const updateObject = {};
        
        Object.keys(entry).forEach((k) => { 
            if(k === '_id') {
                return;
            }
            
            updateObject[`faq.$[el].${k}`] = entry[k];
        });
        
        const cmd = {
            query: {
                $set:  updateObject
            },
            options: {
                new: true,
                runValidators: true,
                arrayFilters: [{ "el._id": entry._id}]
            }
        }
        
        updateCmds.push(cmd);
    });

    varientEntries.forEach((entry) => {
        const updateObject = {};
        
        Object.keys(entry).forEach((k) => { 
            if(k === '_id') {
                return;
            } 
            
            updateObject[`varients.$[el].${k}`] = entry[k];
        });

        const cmd = {
            query: {
                $set:  updateObject
            },
            options: {
                new: true,
                runValidators: true,
                arrayFilters: [{ "el._id": entry._id}]
            }
        }
        
        updateCmds.push(cmd);
    });

    //varients for which media is deleted 
    
    deleteMediaForUpdatedVarients.forEach((m) => {
        m = m.split(':');
        const cmd = {
            query: {
                $pull: {
                    "varients.$[el].media": {
                        "_id": m[1]
                    }
                }
            },
            options: {
                new: true,
                runValidators: true,
                arrayFilters: [
                    { "el._id": m[0]}
                ]
            }
        };

        updateCmds.push(cmd);
    });
    
    

    // // varients for which media is added
    // varientEntries.forEach((v) => {
    //     productMedia[v.skuID].forEach((m) => {
    //         v.media.push({
    //             originalFilename: m.originalFilename,
    //             path: m.path
    //         });
    //     })
    // });

    return updateCmds;
}


module.exports.parseAndGetDBReq = parseAndGetDBReq;