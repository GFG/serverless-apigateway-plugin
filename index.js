'use strict';

const Promise = require('bluebird');
const AWS = require('aws-sdk');

class APIGatewayCustomiser {
  constructor(serverless, options) {
    this.createDeploymentRetryDelay = options.createDeploymentRetryDelay || 5 * 1000;
    this.serverless = serverless;
    // this.options = options;
    this.custom = this.serverless.service.custom;
    this.hooks = {
      'after:deploy:deploy': this.afterDeployFunctions.bind(this)
    };
  }

  /**
   * @description hook to after deployment
   *
   * @return {Promise}
   */
  afterDeployFunctions() {
    this.stage = this.serverless.service.provider.stage || 'dev';
    this.region = this.serverless.service.provider.region || 'ap-southeast-1';
    this.providerName = this.serverless.service.provider.name;
    this.apiName = this.serverless.getProvider(this.providerName).naming.getApiGatewayName();
    this.apiGatewaySDK = new AWS.APIGateway({ region: this.region });
    return this.modifyAPIGateway();
  }

  /**
   * @description modify the gateway
   */
  modifyAPIGateway() {
    this.serverless.cli.log('API Gateway Configuring: Start');
    /** Filter functions for those need API Gateway Config */
    if (this.custom.apigateway) {
      return new Promise((resolve, reject) => {
        this.apiGatewaySDK.getRestApis({ limit: 500 }, (err, data) => {
          if (err) {
            reject(err);
          }
          const api = data.items.find(entry => entry.name === this.apiName);
          if (api !== undefined) {
            resolve(api.id);
          }
        });
      })
        .then(async (apiId) => {
          this.serverless.cli.log('Running with async/await');
          const { responses, binaryTypes } = this.custom.apigateway;
          if (responses) {
            for (let i = 0; i < responses.length; i++) {
              const response = responses[i];
              if (response.response.headers) {
                await this.configHeaders(apiId, response.response);
              }
              if (response.response.bodyMappingTemplate) {
                await this.configBodyMapping(apiId, response.response);
              }
            }
          }
          if (binaryTypes) {
            await this.configBinary(apiId);
          }
          return apiId;
        })
        .then((apiId) => {
          this.createDeployment(apiId);
        })
        .then(() => this.serverless.cli.log('API Gateway Configuring: End'))
        .catch((err) => {
          throw err;
        });
    }
  }

  /**
   * @description this is to creates a deployment resources, to make all changes effect
   *
   * @param apiId - the API id
   * @param response
   */
  createDeployment(apiId) {
    return new Promise((resolve, reject) => {
      this.apiGatewaySDK.createDeployment(
        {
          restApiId: apiId,
          stageName: this.stage,
          description: 'This deployment created by serverless-apigateway-plugin'
        },
        (error, data) => {
          if (error) {
            if (error.code === 'TooManyRequestsException') {
              this.serverless.cli.log('Deployment failed! Retry in 5s');
              setTimeout(() => {
                this.createDeployment(apiId);
              }, this.createDeploymentRetryDelay);
            } else {
              reject(error);
            }
          } else {
            this.serverless.cli.log('Create deployment finished');
            resolve('Success');
          }
        }
      );
    });
  }

  /**
   * @description this is to configure the headers
   *
   * @param apiId - the API id
   * @param response
   */
  configHeaders(apiId, response) {
    return new Promise((resolve, reject) => {
      const params = {
        responseType: response.type.toString(),
        /* required */
        restApiId: apiId,
        /* required */
        responseParameters: response.headers ? response.headers : {},
        statusCode: response.statusCode.toString()
      };
      this.apiGatewaySDK.putGatewayResponse(params, (err, data) => {
        if (err) {
          reject(err);
        } else {
          this.serverless.cli.log('API Gateway Configuring: Headers are set correctly');
          resolve(`Header set successfully: ${response.type.toString()}`);
        }
      });
    });
  }

  /**
   * @description configure the body mapping templates
   *
   * @param apiId
   * @param response
   */
  configBodyMapping(apiId, response) {
    return new Promise((resolve, reject) => {
      const params = {
        responseType: response.type.toString(),
        /* required */
        restApiId: apiId,
        /* required */
        patchOperations: [
          {
            op: 'add',
            path: `/responseTemplates/${response.bodyMappingTemplate.contentType.replace(
              '/',
              '~1'
            )}`,
            value: response.bodyMappingTemplate.content
          }
        ]
      };
      this.apiGatewaySDK.updateGatewayResponse(params, (err, data) => {
        if (err) {
          reject(err);
        } else {
          this.serverless.cli.log(
            'API Gateway Configuring: Body mapping templates are set correctly'
          );
          resolve(`Body Mapping Templates set successfully: ${response.type.toString()}`);
        }
      });
    });
  }

  /**
   * @description binary support configuration
   * @param apiId
   */
  configBinary(apiId) {
    const patchOperationsArray = [];
    this.custom.apigateway.binaryTypes.forEach((e) => {
      patchOperationsArray.push({
        op: 'add',
        path: `/binaryMediaTypes/${e.replace('/', '~1')}`
      });
    });
    return new Promise((resolve, reject) => {
      const params = {
        restApiId: apiId,
        /* required */
        patchOperations: patchOperationsArray
      };
      this.apiGatewaySDK.updateRestApi(params, (err, data) => {
        if (err) {
          reject(err);
        } else {
          this.serverless.cli.log('API Gateway Configuring: Binary support are set correctly');
          resolve('binary set successfully');
        }
      });
    });
  }
}

module.exports = APIGatewayCustomiser;
