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
            
            const { error } = validateHTTPReqPayload(productDetails, productMedia);
            
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

            let output = _patchGetDeleteSubDocumentsDBCmd(productDetails);
            output.dbCommands ? dbCmds.push(output.dbCommands) : null;

            if(output.error) {
                resolve({error: {code: 400, msg: `Bad Input ${err.msg}`}});
                return;
            }

            output = _pathcGetCreateSubDocumentsDBCmd(productDetails, productMedia);
            output.dbCommands ? dbCmds.push(output.dbCommands) : null;

            if(output.error) {
                resolve({error: {code: 400, msg: `Bad Input ${err.msg}`}});
                return;
            }

            output = _pathGetUpdateSubDocumentsDBCmd(productDetails, productMedia);
            dbCmds = output.dbCommands ? [...dbCmds, ...output.dbCommands] : dbCmds;

            if(output.error) {
                resolve({error: {code: 400, msg: `Bad Input ${err.msg}`}});
                return;
            }

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

            return {dbCommands: {query: delExp, options: {new: true, runValidators: true}}, error: null};
        }

        return {error: null, dbCommands: null};
}

const _pathcGetCreateSubDocumentsDBCmd = (productDetails, productMedia) => {

    const faq = productDetails.faq;
    const varients = productDetails.varients;

    if(varients && varients.create) {
        varients.create.forEach((v) => {
            if(productMedia[v.skuID]) {
                productMedia[v.skuID].forEach((m) => {
                    v.media = [];
                    v.media.push({
                        originalFilename: m.originalFilename,
                        path: m.path
                    });
                });
            }
            else {
                return {dbCommands: null, error: {code: 400, msg: `Media not provided for SKUId ${v.skuID}`}};
            }
        })
    }

    if((faq && faq.create)|| (varients && varients.create)) {
        const createExp = {$push: {}};

        faq && faq.create ? createExp.$push.faq = {  $each: faq.create } : null;
        varients && varients.create ? createExp.$push.varients = {  $each: varients.create } : null;

        return {dbCommands: {query: createExp, options: {new: true, runValidators: true}}, error: null};
    }

    return {dbCommands: null, error: null};
}

const _pathGetUpdateSubDocumentsDBCmd = (productDetails, productMedia) => {
    const updateCmds = [];

    const {faq, varients} = productDetails;

    const faqEntries = faq && faq.update ? faq.update : [];
    const varientEntries = varients && varients.update ? varients.update : [];
    const deleteMediaForUpdatedVarients = varients && varients.deleteMediaForUpdatedVarients ? varients.deleteMediaForUpdatedVarients : [];
    const addMediaForUpdatedVarients = varients && varients.addMediaForUpdatedVarients ? varients.addMediaForUpdatedVarients : [];

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

    //varients for which media is added
    addMediaForUpdatedVarients.forEach((skuID) => {
        if(productMedia[skuID]) {

            const medias = [];

            productMedia[skuID].forEach((m) => {
                medias.push({
                    originalFilename: m.originalFilename,
                    path: m.path
                });
            });

            const cmd = {
                query: {
                    $push: {
                        "varients.$[el].media": {$each: medias}
                    }
                },
                options: {
                    new: true,
                    runValidators: true,
                    arrayFilters: [
                        { "el.skuID": skuID}
                    ]
                }
            };
        }
        else {
            //corresponding file is not provided in form data
            //BAD Input
            return {dbCommands: [], error: {code: 400, msg: `Media not provided for SKUId ${skuID}`}};
        }
        
    });

    //varients for which media is deleted.
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
                    { "el.skuID": m[0]}
                ]
            }
        };

        updateCmds.push(cmd);
    });
    
    return {dbCommands: updateCmds, error: null};
}


module.exports.parseAndGetDBReq = parseAndGetDBReq;