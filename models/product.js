const mongoose = require('mongoose');
const Joi = require('joi');
const productsModelDebugger = require('debug')('app:models:products');


const skuIDPattern = /^[a-zA-Z0-9]+$/i;
const productTitlePattern = /^[a-zA-Z0-9 ]+$/i;
const productTitlePatternMinLen = 5;
const productTitlePatternMaxLen = 25;
const productDescriptionMinLen = 20;
const productDescriptionMaxLen = 255;
const faqQueMinLen = 10;
const faqQueMaxLen = 255;
const faqAnsMinLen = 3;
const faqAnsMaxLen = 500;

//Mongoose Schema
const FaqSchema = new mongoose.Schema({
    question: {
        type: String,
        minLength: faqQueMinLen,
        maxLenght: faqQueMaxLen,
    },
    answer: {
        type: String,
        minLength: faqAnsMinLen, // answer can be as small as 'Yes.' / 'No.'
        maxLenght: faqAnsMaxLen,
    }
});

const MediaSchema = new mongoose.Schema({
    originalFilename: {
        type: String,
        required: true
    },
    path: {
        type: String,
        required: true
    }

});

const VarientsSchema = new mongoose.Schema({
    skuID: {
        type: String,
        match: skuIDPattern
    }, 
    productTitle: {
        type: String,
        required: true,
        minLength: productTitlePatternMinLen,
        maxLenght: productTitlePatternMaxLen,
        match: productTitlePattern
    },
    productDescription: {
        type: String,
        required: true,
        minLength: productDescriptionMinLen,
        maxLenght: productDescriptionMaxLen
    },
    media: {
        type: [MediaSchema],
        required: true,
        validate: {
            validator: function(v) {
                console.log('hello')
                return (v && v.length > 0);
            },
            message: 'There should atleast be one media'       
        }
    },
    isActive: {
        type: Boolean,
        required: true
    },
    dicountedListPrice: {
        type: Number,
        required: true
    },
    listPrice: {
        type: Number,
        required: true
    },
    EANCode: {
        type: Number,
        required: true
    }, 
    HSNCode: {
        type: Number,
        required: true
    }, 
    taxPercentage: {
        type: Number,
        required: true
    }, 
    color: {
        type: String
    },
    size: {
        type: String
    }
}, {timestamps: true});

const ProductSchema = new mongoose.Schema({
    faq: {
        type: [FaqSchema]
    },
    varients: {
        type: [VarientsSchema],
        required: true,
        validate: {
            validator: function(v) {
                return (v && v.length > 0);
            },
            message: 'There should atleast be one varient'       
        }    
    }
}, {timestamps: true});

const Product = mongoose.model('Product', ProductSchema);



//HTTP req schema
const faqValidators = {
    question: Joi.string().min(faqQueMinLen).max(faqQueMaxLen).required(),
    answer: Joi.string().min(faqAnsMinLen).max(faqAnsMaxLen).required()
};

const mediaValidators = {
    originalFilename: Joi.string().required(),
    path: Joi.string().required()
};

const varientValidators = {
    skuID: Joi.string().pattern(skuIDPattern).required(),
    productTitle: Joi.string().min(productTitlePatternMinLen).max(productTitlePatternMaxLen).pattern(productTitlePattern).required(),
    productDescription: Joi.string().min(productDescriptionMinLen).max(productDescriptionMaxLen).required(),
    isActive: Joi.boolean().required(),
    dicountedListPrice: Joi.number().required(),
    listPrice: Joi.number().required(),
    EANCode: Joi.number().required(),
    HSNCode: Joi.number().required(),
    taxPercentage: Joi.number().required(),
    color: Joi.string(),
    size: Joi.string()
}


const validateProduct = (productDetails, productFileNames) => {
    let {error} = validateProductDetails(productDetails);

    if(!error) {
        return (validateProductFiles(productDetails, productFileNames));
    }

    return {error: error};
};

const validateProductDetails = (productDetails) => {

    const varientsSchema = Joi.object(varientValidators);

    let productSchema = Joi.object({
        faq: Joi.array().min(0).items(Joi.object(faqValidators)).required(),
        varients: Joi.array().min(1).items(varientsSchema).required()
    });
    
    return productSchema.validate(productDetails);
};

const validateProductFiles = (productDetails, productMedia) => {
    const skuIDS = productDetails.varients.map((v) => {
        return v.skuID
    });

    const media = Object.keys(productMedia);
    
    //Javascript array HOC are inefficient. Use plane for loop
    for(let i = 0; i < skuIDS.length; i++) {
        if(!media.includes(skuIDS[i])) {
            return(
                {error: new Error(`skuID ${skuIDS[i]} in productDetails is not present as a form field` )}
            );
        }
    }

    return true
};


const validateProductPatchHTTPReq = (productDetails) => {
    //FaqHTTPPatch
    const faqValidatorSchema = Joi.object(faqValidators);
    const faqUpdateValidatorSchema = Joi.object(Object.assign({_id: Joi.string().required()}, faqValidators));
    
    const faqPatchSchema = Joi.object({
        delete: Joi.array().min(1).items(Joi.string()),
        create: Joi.array().min(1).items(faqValidatorSchema),
        update: Joi.array().min(1).items(faqUpdateValidatorSchema)
    }).or('delete', 'create', 'update');

    ////VarientHTTPPatch
    const varientsSchema = Joi.object(varientValidators); 
    const varientUpdateSchema = varientsSchema.fork(Object.keys(varientValidators), (schema) => {
        return schema.optional();
    })
    .or(...Object.keys(varientValidators))
    .append({_id: Joi.string().required() });
    
    const varientPatchSchema = Joi.object({
        delete: Joi.array().min(1).items(Joi.string()),
        create: Joi.array().min(1).items(varientsSchema),
        update: Joi.array().min(1).items(varientUpdateSchema),
        deleteMediaForDeletedVarients: Joi.array().min(1).items(Joi.string()), //file names to be deleted from disk
        deleteMediaForUpdatedVarients: Joi.array().min(1).items(Joi.string()), //skuID:media _id:file_name
        addMediaForUpdatedVarients: Joi.array().min(1).items(Joi.string()), //skuID
    }).with('delete', 'deleteMediaForDeletedVarients').or('delete', 'create', 'update', 'deleteMediaForUpdatedVarients', 'addMediaForUpdatedVarients');

    const productSchema = Joi.object({
        faq: faqPatchSchema,
        varients: varientPatchSchema
    }).or('faq', 'varients');

    return productSchema.validate(productDetails);
};

const validateHTTPReqPayload = (productDetails, productFileNames, httpMethod) => {
    let isValid = false;

    switch(httpMethod) {
        case 'POST': 
            isValid = validateProduct(productDetails, productFileNames);
            break;
        case 'PUT': 
            isValid = validateProduct(productDetails, productFileNames, true);
            break;
        case 'PATCH': 
            isValid = validateProductPatchHTTPReq(productDetails);
            break;
        default:
            productsModelDebugger(`Validator not implemented for ${httpMethod}`);
            isValid = false;
    }

    return isValid
}

exports.Product = Product;
exports.validateHTTPReqPayload = validateHTTPReqPayload; 





    