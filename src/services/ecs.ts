import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import * as apigatewayv2_integrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Credentials } from 'aws-cdk-lib/aws-rds';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { AppContext, RDSEngine, StackConfig } from '../config';
import { Size } from 'aws-cdk-lib';

export class WebhookECS extends cdk.Stack {
  vpc: ec2.Vpc;
  logGroups: logs.LogGroup[];
  rds: rds.DatabaseInstance;
  elasticCache: elasticache.CfnCacheCluster;
  ecrList: ecr.Repository[];
  ecs: ecs.Cluster;

  constructor(appContext: AppContext, stackConfig: StackConfig) {

    super(appContext.cdkApp, stackConfig.webhookECS.name, {
      stackName: stackConfig.webhookECS.name,
      description: stackConfig.webhookECS.description
    });

    // Create VPC
    // this.createVPC(stackConfig);

    // Create ElasticCache
    // this.createElasticCache(this.vpc, stackConfig);

    // Create Cloudwatch group
    // this.createCloudWatchGroup(stackConfig);

    // Create ECR Repositories
    // this.createECRRepositories(stackConfig);

    // Create RDS
    // this.createRDS(this.vpc, stackConfig);

    // Create ECS Cluster
    this.createECS();
  }

  createVPC(stackConfig: StackConfig) {
    const vpc = stackConfig.webhookECS.vpc;
    this.vpc = new ec2.Vpc(this, vpc.name, {
      cidr: vpc.cidr,
      maxAzs: vpc.maxAZs,
      subnetConfiguration: vpc.subnetConfiguration,
    });

    // Create VPC Endpoint for Parameter Store can connect
    // this.createVpcEndpoint(this.vpc);

    // Output the URI of the vpc
    new cdk.CfnOutput(this, this.vpc.vpcId, {
      value: this.vpc.vpcArn,
      description: 'URI of the ECR repository',
    });
  }

  createVpcEndpoint(vpc: ec2.Vpc) {
    const parameterStoreEndpoint = new ec2.InterfaceVpcEndpoint(this, 'ParameterStoreEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
      vpc,
    });

    // Create an IAM role for the VPC endpoint
    const vpcEndpointRole = new iam.Role(this, 'ParameterStoreEndpointRole', {
      assumedBy: new iam.ServicePrincipal('vpc-endpoint.amazonaws.com'),
    });

    // Attach the inline policy to the IAM role
    vpcEndpointRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:PutParameter', 'ssm:GetParameter'],
        resources: ['*'],
        effect: iam.Effect.ALLOW,
      })
    );

    // Associate the IAM role with the VPC endpoint
    parameterStoreEndpoint.addToPolicy(
      new iam.PolicyStatement({
        actions: ['*'],
        resources: ['*'],
        effect: iam.Effect.ALLOW,
        principals: [new iam.ArnPrincipal(vpcEndpointRole.roleArn)],
      })
    );
  }

  createECS() {
    // Create VPC with isolated (no routing to internet) subnets
    const vpc = new ec2.Vpc(this, 'Vpc', {
      cidr: '10.0.0.0/16',
      enableDnsSupport: true,
      maxAzs: 1,
      subnetConfiguration: [{ cidrMask: 24, name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
    });

    // Configure VPC for required services

    // ECR images are stored in s3, and thus s3 is needed
    vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    vpc.addInterfaceEndpoint('EcrEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      privateDnsEnabled: true,
      open: true,
    });

    vpc.addInterfaceEndpoint('EcrDockerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      privateDnsEnabled: true,
      open: true,
    });

    vpc.addInterfaceEndpoint('LogsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      privateDnsEnabled: true,
      open: true,
    });

    vpc.addInterfaceEndpoint('ApiGatewayEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.APIGATEWAY,
      privateDnsEnabled: true,
      open: true,
    });

    // Create API Gateway VPC Link to get the service connected to VPC
    const vpcLink = new apigatewayv2.VpcLink(this, 'VpcLink', {
      vpc: vpc,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // Create Service Discovery (Cloud Map) namespace
    const dnsNamespace = new servicediscovery.PrivateDnsNamespace(this, 'DnsNamespace', {
      name: 'testlocal',
      vpc: vpc,
    });

    // Create ECS cluster
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: vpc,
      enableFargateCapacityProviders: true,
    });

    // Declare the ECS Task; one small container, built locally
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: 256,
      memoryLimitMiB: 512,
    });

    const container = taskDefinition.addContainer('Container', {
      image: ecs.ContainerImage.fromAsset('./image'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'ecs',
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
        maxBufferSize: Size.mebibytes(25),
      }),
    });

    container.addPortMappings({ containerPort: 80 });

    // Create Security Group to allow traffic to the Service
    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc: vpc,
      allowAllOutbound: true,
      description: 'Allow traffic to Fargate HTTP API service.',
      securityGroupName: 'ServiceSecurityGroup',
    });

    serviceSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(80));

    // Create the ECS service and register it to Service Discovery (Cloud Map)
    const service = new ecs.FargateService(this, 'Service', {
      cluster: cluster,
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 1,
        },
        {
          capacityProvider: 'FARGATE',
          weight: 0,
        },
      ],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [serviceSecurityGroup],
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      taskDefinition: taskDefinition,
      circuitBreaker: {
        rollback: true,
      },
      assignPublicIp: false,
      desiredCount: 1,
      cloudMapOptions: {
        name: 'service',
        cloudMapNamespace: dnsNamespace,
        dnsRecordType: servicediscovery.DnsRecordType.SRV,
      },
    });

    // Create API Gateway HTTP API and point it to the ECS service via Service Discovery and VPC Link
    const api = new apigatewayv2.HttpApi(this, 'API', {
      defaultIntegration: new apigatewayv2_integrations.HttpServiceDiscoveryIntegration(
        'ServiceDiscoveryIntegration',
        //@ts-ignore
        service.cloudMapService,
        {
          vpcLink: vpcLink,
        },
      ),
    });

    // Print out the API endpoint after the deploy
    new cdk.CfnOutput(this, 'Url', {
      value: api.url ?? 'Something went wrong',
    });
  }

  createECRRepositories(stackConfig: StackConfig) {
    const listRepositoriesName = stackConfig.webhookECS.ecr.repositoriesName || [];
    for (const repoName of listRepositoriesName) {
      // Create ECR repository
      const ecrRepository = new ecr.Repository(this, repoName, {
        repositoryName: repoName, // Specify the name of the ECR repository
      });
      this.ecrList.push(ecrRepository);

      // Output the URI of the ECR repository
      new cdk.CfnOutput(this, repoName, {
        value: ecrRepository.repositoryUri,
        description: 'URI of the ECR repository',
      });
    }
  }

  createElasticCache(vpc: ec2.Vpc, stackConfig: StackConfig) {
    const elasticCacheConfig = stackConfig.webhookECS.elasticCache;
    // Create ElastiCache Redis cluster
    this.elasticCache = new elasticache.CfnCacheCluster(this, elasticCacheConfig.name, {
      engine: elasticCacheConfig.engine || 'redis',
      cacheNodeType: elasticCacheConfig.cacheNodeType || 'cache.t2.micro', // Adjust based on your needs
      numCacheNodes: elasticCacheConfig.numCacheNodes || 1, // Adjust based on your needs
      vpcSecurityGroupIds: [], // Security groups will be added dynamically
      cacheSubnetGroupName: new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
        description: 'Subnet group for Redis',
        subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
      }).ref,
    });

    // Allow instances in the VPC to connect to the Redis cluster
    const securityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc,
    });
    securityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(6379));

    // Update the ElastiCache Redis cluster with the security group
    this.elasticCache.vpcSecurityGroupIds = [securityGroup.securityGroupId];

    // Save Redis endpoint to Parameter Store
    const redisSSM = stackConfig.webhookECS.ssmParameter.redis.host.name;
    new ssm.StringParameter(this, redisSSM, {
      parameterName: redisSSM,
      stringValue: this.elasticCache.attrRedisEndpointAddress,
    });

    // Output the endpoint of the Redis cluster
    new cdk.CfnOutput(this, 'RedisClusterEndpoint', {
      value: this.elasticCache.attrRedisEndpointAddress,
      description: 'Endpoint of the ElastiCache Redis cluster',
    });
  }

  createRDS(vpc: ec2.Vpc, stackConfig: StackConfig) {
    const rdsConfig = stackConfig.webhookECS.rds;
    // Create RDS instance in the existing VPC
    this.rds = new rds.DatabaseInstance(this, rdsConfig.name, {
      engine: RDSEngine[rdsConfig.engine], // Use PostgreSQL as the database engine
      credentials: Credentials.fromPassword(stackConfig.rds.username, stackConfig.rds.password),
      vpc: vpc, // Use the existing VPC
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_NAT }, // Specify the subnets where the RDS instance should be launched
      allocatedStorage: rdsConfig.allocatedStorage, // Specify the allocated storage in GB
    });

    // Save rds endpoint to Parameter Store
    // const rdsSSM = stackConfig.webhookECS.ssmParameter.rds.host.name;
    // new ssm.StringParameter(this, rdsSSM, {
    //   parameterName: rdsSSM,
    //   stringValue: this.rds.instanceEndpoint.socketAddress,
    // });

    // Output the connection details of the RDS instance
    new cdk.CfnOutput(this, 'RDSConnectionDetails', {
      value: this.rds.dbInstanceEndpointAddress,
      description: 'Connection details of the RDS instance',
    });
  }

  createCloudWatchGroup(stackConfig: StackConfig) {
    const logGroupNames = stackConfig.webhookECS.logs.logGroupNames || [];
    for (const logGroupName of logGroupNames) {
      const log = new logs.LogGroup(this, logGroupName, {
        logGroupName: logGroupName, // Specify the name of the log group
        retention: stackConfig.webhookECS.logs.retention, // Specify the retention period in days
      });

      this.logGroups.push(log);

      // Output the log group
      new cdk.CfnOutput(this, logGroupName, {
        value: log.logGroupName,
        description: `Log group ${logGroupName} created.`,
      });
    }
  }
}
