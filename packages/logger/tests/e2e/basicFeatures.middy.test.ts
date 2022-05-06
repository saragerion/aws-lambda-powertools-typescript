// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Test logger basic features
 *
 * @group e2e/logger/basicFeatures
 */

import path from 'path';
import { randomUUID } from 'crypto';
import { App, Stack } from 'aws-cdk-lib';
import {
  createStackWithLambdaFunction,
  generateUniqueName,
  invokeFunction,
  isValidRuntimeKey
} from '../../../commons/tests/utils/e2eUtils';
import { InvocationLogs } from '../../../commons/tests/utils/InvocationLogs';
import { deployStack, destroyStack } from '../../../commons/tests/utils/cdk-cli';
import {
  RESOURCE_NAME_PREFIX,
  STACK_OUTPUT_LOG_GROUP,
  SETUP_TIMEOUT,
  TEST_CASE_TIMEOUT,
  TEARDOWN_TIMEOUT
} from './constants';

const runtime = `nodejs${process.env.NODE_VERSION || '14'}x`;

if (!isValidRuntimeKey(runtime)) {
  throw new Error(`Invalid runtime key value: ${runtime}`);
}

const LEVEL = InvocationLogs.LEVEL;

const uuid = randomUUID();
const stackName = generateUniqueName(RESOURCE_NAME_PREFIX, uuid, runtime, 'BasicFeatures-Middy');
const functionName = generateUniqueName(RESOURCE_NAME_PREFIX, uuid, runtime, 'BasicFeatures-Middy');
const lambdaFunctionCodeFile = 'basicFeatures.middy.test.FunctionCode.ts';

// Text to be used by Logger in the Lambda function
const PERSISTENT_KEY = 'persistentKey';
const PERSISTENT_VALUE = `a persistent value that will be put in every log ${uuid}`;
const SINGLE_LOG_ITEM_KEY = `keyForSingleLogItem${uuid}`;
const SINGLE_LOG_ITEM_VALUE = `a value for a single log item${uuid}`;
const ERROR_MSG = `error-${uuid}`;

const integTestApp = new App();
let logGroupName: string; // We do not know it until deployment
let stack: Stack;

describe(`logger E2E tests basic functionalities (middy) for runtime: ${runtime}`, () => {

  let invocationLogs: InvocationLogs[];

  beforeAll(async () => {
    // Create and deploy a stack with AWS CDK
    stack = createStackWithLambdaFunction({
      app: integTestApp,
      stackName: stackName,
      functionName: functionName,
      functionEntry: path.join(__dirname, lambdaFunctionCodeFile),
      environment: {
        LOG_LEVEL: 'INFO',
        POWERTOOLS_SERVICE_NAME: 'logger-e2e-testing',
        UUID: uuid,

        // Text to be used by Logger in the Lambda function
        PERSISTENT_KEY,
        PERSISTENT_VALUE,
        SINGLE_LOG_ITEM_KEY,
        SINGLE_LOG_ITEM_VALUE,
        ERROR_MSG,
      },
      logGroupOutputKey: STACK_OUTPUT_LOG_GROUP,
      runtime: runtime,
    });

    const result = await deployStack(integTestApp, stack);
    logGroupName = result.outputs[STACK_OUTPUT_LOG_GROUP];

    // Invoke the function twice (one for cold start, another for warm start)
    invocationLogs = await invokeFunction(functionName, 2, 'SEQUENTIAL');

    console.log('logGroupName', logGroupName);

  }, SETUP_TIMEOUT);

  describe('Log level filtering', () => {
    it('should filter log based on LOG_LEVEL (INFO) environment variable in Lambda', async () => {
      const debugLogs = invocationLogs[0].getFunctionLogs(LEVEL.DEBUG);
      expect(debugLogs.length).toBe(0);
    }, TEST_CASE_TIMEOUT);
  });

  describe('Context data', () => {
    it('should log context information of the function', async () => {
      const logMessages = invocationLogs[0].getFunctionLogs();

      for (const message of logMessages) {
        expect(message).toContain('function_arn');
        expect(message).toContain('function_memory_size');
        expect(message).toContain('function_name');
        expect(message).toContain('function_request_id');
        expect(message).toContain('timestamp');
      }
    }, TEST_CASE_TIMEOUT);

    it('should include cold start equal to TRUE only on the first invocation', async () => {
      const coldStartLogMessages = invocationLogs[0].getFunctionLogs(LEVEL.INFO);
      for (const message of coldStartLogMessages) {
        expect(message).toContain(`"cold_start":true`);
      }

      const normalLogMessages = invocationLogs[1].getFunctionLogs(LEVEL.INFO);
      for (const message of normalLogMessages) {
        expect(message).not.toContain(`"cold_start":true`);
      }
    }, TEST_CASE_TIMEOUT);
  });

  describe('Context data', () => {
    it('should log context information in every log', async () => {
      const logMessages = invocationLogs[0].getFunctionLogs();

      for (const message of logMessages) {
        expect(message).toContain('function_arn');
        expect(message).toContain('function_memory_size');
        expect(message).toContain('function_name');
        expect(message).toContain('function_request_id');
        expect(message).toContain('timestamp');
      }
    }, TEST_CASE_TIMEOUT);
  });

  describe('Persistent additional log keys and values', () => {
    it('should contain persistent value in every log', async () => {
      const logMessages = invocationLogs[0].getFunctionLogs();

      for (const message of logMessages) {
        expect(message).toContain(`"${PERSISTENT_KEY}":"${PERSISTENT_VALUE}"`);
      }
    }, TEST_CASE_TIMEOUT);
  });

  describe('X-Ray Trace ID injection', () => {
    it('should inject & parse X-Ray Trace ID into every log', async () => {
      const logMessages = invocationLogs[0].getFunctionLogs();

      for (const message of logMessages) {
        expect(message).toContain('xray_trace_id');
      }
    }, TEST_CASE_TIMEOUT);
  });

  describe('One-time additional log keys and values', () => {
    it('should log additional keys and value only once', async () => {
      const logMessages = invocationLogs[0].getFunctionLogs()
        .filter(message => message.includes(`"${SINGLE_LOG_ITEM_KEY}":"${SINGLE_LOG_ITEM_VALUE}"`));

      expect(logMessages).toHaveLength(1);
    }, TEST_CASE_TIMEOUT);
  });

  describe('Logging an error object', () => {
    it('should log additional keys and value only once', async () => {
      const logMessages = invocationLogs[0].getFunctionLogs(LEVEL.ERROR)
        .filter(message => message.includes(ERROR_MSG));

      expect(logMessages).toHaveLength(1);

      const logObject = InvocationLogs.parseFunctionLog(logMessages[0]);
      const errorObj = logObject.error;

      expect(errorObj.name).toBe('Error');
      expect(errorObj.message).toBe(ERROR_MSG);
      expect(errorObj.stack).toBeDefined();
    }, TEST_CASE_TIMEOUT);
  });

  afterAll(async () => {
    if (!process.env.DISABLE_TEARDOWN) {
      await destroyStack(integTestApp, stack);
    }
  }, TEARDOWN_TIMEOUT);
});
