import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as cdk from 'aws-cdk-lib';
import { AppContext, StackCommonProps, StackConfig } from '../config';
import { Credentials } from 'aws-cdk-lib/aws-rds';

export class WebhookECS extends cdk.Stack {
  constructor(appContext: AppContext, stackConfig: any) {
    let newProps = WebhookECS.getStackCommonProps(appContext, stackConfig);
    super(appContext.cdkApp, stackConfig.Name, newProps);

    // Create VPC
    const vpc = new ec2.Vpc(
      stackConfig.VPCName,
      stackConfig.VPCMaxAzs,
      stackConfig.VPCCIDR,
    );
    // Output the URI of the vpc
    new cdk.CfnOutput(this, vpc.vpcId, {
      value: vpc.vpcArn,
      description: 'URI of the ECR repository',
    });

    // Create ECR Repositories
    this.createECRRepositories(stackConfig);

    // Create ElasticCache
    this.createElasticCache(vpc);

    // Create RDS
    this.createRDS(vpc, stackConfig);

    // Create Cloudwatch group
    this.createCloudWatchGroup(stackConfig);

    // Create ECS Cluster
    this.createECS(vpc, stackConfig);
  }

  createECS(vpc: ec2.Vpc, stackConfig: any) {
    const cluster = new ecs.Cluster(this, stackConfig.ECSClusterName, { vpc });
    cluster.addCapacity('DefaultAutoScalingGroup', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO)
    });

    // create a task definition with CloudWatch Logs
    const logging = new ecs.AwsLogDriver({ streamPrefix: "ecs" })

    const taskDef = new ecs.Ec2TaskDefinition(this, "MyTaskDefinition");
    taskDef.addContainer("AppContainer", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memoryLimitMiB: 512,
      logging,
    })

    // Instantiate ECS Service with just cluster and image
    new ecs.Ec2Service(this, "Ec2Service", {
      cluster,
      taskDefinition: taskDef,
    });
  }

  createECRRepositories(stackConfig: any) {
    const listRepositoriesName = stackConfig.RepositoriesName || [];
    for (const repoName of listRepositoriesName) {
      // Create ECR repository
      const ecrRepository = new ecr.Repository(this, repoName, {
        repositoryName: repoName, // Specify the name of the ECR repository
      });

      // Output the URI of the ECR repository
      new cdk.CfnOutput(this, repoName, {
        value: ecrRepository.repositoryUri,
        description: 'URI of the ECR repository',
      });
    }
  }

  createElasticCache(vpc: ec2.Vpc) {
    // Create ElasticCache in the existing VPC
    const elasticCacheCluster = new elasticache.CfnCacheCluster(this, 'ElasticCacheCluster', {
      cacheNodeType: 'cache.t2.micro', // Specify the desired node type
      engine: 'redis', // Specify the cache engine (redis or memcached)
      numCacheNodes: 1, // Specify the number of cache nodes
      vpcSecurityGroupIds: [vpc.vpcDefaultSecurityGroup], // Use the default security group of the VPC
    });
    // Output the endpoint of the ElastiCache cluster
    new cdk.CfnOutput(this, 'ElasticCacheEndpoint', {
      value: elasticCacheCluster.attrRedisEndpointAddress,
      description: 'Endpoint of the ElastiCache cluster',
    });
  }

  createRDS(vpc: ec2.Vpc, stackConfig: any) {
    // Create RDS instance in the existing VPC
    const rdsInstance = new rds.DatabaseInstance(this, 'MyRDSInstance', {
      engine: rds.DatabaseInstanceEngine.POSTGRES, // Use PostgreSQL as the database engine
      credentials: Credentials.fromPassword(stackConfig.rds.username, stackConfig.rds.password),
      vpc: vpc, // Use the existing VPC
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }, // Specify the subnets where the RDS instance should be launched
      allocatedStorage: 20, // Specify the allocated storage in GB
    });

    // Output the connection details of the RDS instance
    new cdk.CfnOutput(this, 'RDSConnectionDetails', {
      value: rdsInstance.dbInstanceEndpointAddress,
      description: 'Connection details of the RDS instance',
    });
  }

  createCloudWatchGroup(stackConfig: any) {
    const logGroupNames = stackConfig.logGroupNames || [];
    for (const logGroupName of logGroupNames) {
      new logs.LogGroup(this, logGroupName, {
        logGroupName: logGroupName, // Specify the name of the log group
        retention: logs.RetentionDays.ONE_WEEK, // Specify the retention period in days
      });
    }
  }

  private static getStackCommonProps(appContext: AppContext, stackConfig: StackConfig): StackCommonProps {
    let newProps = appContext.stackCommonProps;
    if (stackConfig.UpdateRegionName) {
      console.log(`[INFO] Region is updated: ${stackConfig.Name} ->> ${stackConfig.UpdateRegionName}`);
      newProps = {
        ...appContext.stackCommonProps,
        env: {
          region: stackConfig.UpdateRegionName,
          account: appContext.appConfig.Project.Account
        }
      };
    } else {
      // console.log('not update region')
    }
    return newProps;
  }
}